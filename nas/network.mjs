import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';

export function isPublicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) ||
      (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0));
  }
  if (net.isIP(address) === 6) {
    // Only global unicast; excludes loopback, local, multicast, mapped IPv4 and transition ranges.
    const value = address.toLowerCase();
    return /^[23]/.test(value) && !value.startsWith('2001:db8:') &&
      !value.startsWith('2001:0:') && !value.startsWith('2002:');
  }
  return false;
}

export async function publicTarget(value, resolve = dns.lookup) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('仅支持不含用户名密码的 HTTP/HTTPS 地址');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(hostname)
    ? [{ address: hostname, family: net.isIP(hostname) }]
    : await resolve(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
    throw new Error('音源请求不能访问本机、内网或保留地址');
  return { url, address: addresses[0] };
}

const excluded = new Set(['host', 'connection', 'transfer-encoding', 'content-length',
  'proxy-authorization', 'proxy-connection', 'upgrade', 'accept-encoding']);
export const cleanHeaders = (headers = {}) => Object.fromEntries(Object.entries(headers)
  .filter(([key, value]) => !excluded.has(key.toLowerCase()) &&
    typeof value === 'string' && !/[\r\n]/.test(key + value)));

export async function openPublic(value, options = {}, redirects = 0) {
  const { url, address } = await publicTarget(value);
  const headers = { 'user-agent': 'AlgerNAS/0.1', 'accept-encoding': 'identity',
    ...cleanHeaders(options.headers) };
  const response = await new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      method: options.method || 'GET', headers,
      // Pin the validated DNS result so a second lookup cannot rebind to the LAN.
      lookup: (_hostname, lookupOptions, callback) => lookupOptions.all
        ? callback(null, [address]) : callback(null, address.address, address.family)
    }, resolve);
    request.on('error', reject);
    request.setTimeout(Math.min(Math.max(options.timeout || 30000, 1000), 60000),
      () => request.destroy(new Error('音源请求超时')));
    if (options.body) request.write(options.body);
    request.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
    response.resume();
    if (redirects >= 5) throw new Error('音源重定向次数过多');
    const next = new URL(response.headers.location, url);
    const nextOptions = { ...options, headers: { ...headers } };
    if (next.origin !== url.origin) {
      for (const key of Object.keys(nextOptions.headers))
        if (['authorization', 'cookie'].includes(key.toLowerCase())) delete nextOptions.headers[key];
    }
    if (response.statusCode === 303 ||
        ([301, 302].includes(response.statusCode) && options.method === 'POST')) {
      nextOptions.method = 'GET'; nextOptions.body = undefined;
    }
    return openPublic(next.href, nextOptions, redirects + 1);
  }
  return response;
}

export async function readBody(stream, limit = 8 * 1024 * 1024, truncate = false) {
  const chunks = []; let size = 0;
  for await (const chunk of stream) {
    if (size + chunk.length > limit) {
      if (!truncate) { stream.destroy(); throw new Error('音源响应超过大小限制'); }
      chunks.push(chunk.subarray(0, limit - size));
      stream.destroy(); break;
    }
    chunks.push(chunk); size += chunk.length;
  }
  return Buffer.concat(chunks);
}

export function detectAudio(bytes, type = '') {
  if (bytes.subarray(0, 4).toString() === 'fLaC') return { codec: 'flac', mime: 'audio/flac' };
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return { codec: 'aac', mime: 'audio/aac' };
  if (bytes.subarray(0, 3).toString() === 'ID3' ||
      (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return { codec: 'mp3', mime: 'audio/mpeg' };
  if (bytes.subarray(0, 4).toString() === 'OggS') return { codec: 'ogg', mime: 'audio/ogg' };
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE')
    return { codec: 'wav', mime: 'audio/wav' };
  if (bytes.subarray(4, 8).toString() === 'ftyp') return { codec: 'm4a', mime: 'audio/mp4' };
  // Reject successful HTML/JSON responses instead of caching them as audio.
  throw new Error(`音源返回的内容不是可识别的音频 (${String(type).split(';')[0] || '未知类型'})`);
}
