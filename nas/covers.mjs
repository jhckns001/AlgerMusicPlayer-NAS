import { createHash } from 'node:crypto';
import { openPublic, readBody } from './network.mjs';

const hosts = new Set(['y.gtimg.cn', 'qpic.y.qq.com']);
export function coverTarget(value) {
  let url;
  try { url = new URL(value); } catch { throw Object.assign(new Error('封面地址不正确'), { status: 400 }); }
  if (!hosts.has(url.hostname) || !['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      (url.port && !['80', '443'].includes(url.port)) ||
      !/^\/(?:music\/(?:photo_new|common\/upload)|music_cover)\//.test(url.pathname))
    throw Object.assign(new Error('不支持这个封面地址'), { status: 400 });
  url.protocol = 'https:';
  return url.href;
}

export function proxyCoverUrl(value) {
  try { return '/nas/cover?url=' + encodeURIComponent(coverTarget(value)); }
  catch { return value; }
}

function imageType(bytes) {
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) return 'image/gif';
  throw Object.assign(new Error('图片服务器没有返回有效封面'), { status: 502 });
}

export function createCoverService({ open = openPublic } = {}) {
  const cache = new Map(), pending = new Map();
  let cacheBytes = 0;
  return async value => {
    const url = coverTarget(value), existing = cache.get(url);
    if (existing?.expires > Date.now()) return existing;
    if (pending.has(url)) return pending.get(url);
    if (pending.size >= 32) throw Object.assign(new Error('封面正在加载，请稍后重试'), { status: 429 });
    const task = (async () => {
      const upstream = await open(url, { timeout: 12000,
        headers: { Referer: 'https://y.qq.com/', 'User-Agent': 'Mozilla/5.0' } });
      if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
        upstream.destroy(); throw Object.assign(new Error('图片服务器暂时无法返回封面'), { status: 502 });
      }
      const bytes = await readBody(upstream, 2 * 1024 * 1024);
      const result = { bytes, type: imageType(bytes), expires: Date.now() + 6 * 3600000,
        etag: '"' + createHash('sha256').update(bytes).digest('hex') + '"' };
      if (cache.has(url)) { cacheBytes -= cache.get(url).bytes.length; cache.delete(url); }
      while (cache.size && (cache.size >= 64 || cacheBytes + bytes.length > 16 * 1024 * 1024)) {
        const key = cache.keys().next().value; cacheBytes -= cache.get(key).bytes.length; cache.delete(key);
      }
      cache.set(url, result); cacheBytes += bytes.length;
      return result;
    })().finally(() => pending.delete(url));
    pending.set(url, task);
    return task;
  };
}
