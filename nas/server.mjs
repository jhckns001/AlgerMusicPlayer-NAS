import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, rename, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { openPublic, readBody, detectAudio } from './network.mjs';
import { createNcmModules } from './ncm-login.mjs';
import { createCatalogService } from './catalog.mjs';
import { startCatalogRuntime } from './catalog-runtime.mjs';
import { createCoverService } from './covers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceKeys = ['lxMusicScripts', 'activeLxMusicApiId', 'enableMusicUnblock',
  'enabledMusicSources', 'musicQuality', 'lxAutoSwitch', 'lxMusicPriority'];
const equal = (a, b) => {
  const left = Buffer.from(String(a || '')), right = Buffer.from(String(b || ''));
  return left.length === right.length && timingSafeEqual(left, right);
};
const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
};
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function createNasServer({ dataDir = path.join(root, 'nas-data'),
  staticDir = path.join(root, 'out/nas'), accessKey, apiPort = 3001,
  open = openPublic, catalog = createCatalogService(), requireAuth = process.env.NAS_REQUIRE_AUTH === '1' } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const loadCover = createCoverService({ open });
  const keyFile = path.join(dataDir, 'access-key');
  const key = accessKey || (existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() :
    randomBytes(24).toString('base64url'));
  if (!accessKey && !existsSync(keyFile)) writeFileSync(keyFile, key + '\n', { mode: 0o600 });
  const sourcesFile = path.join(dataDir, 'sources.json');
  let sourceState = existsSync(sourcesFile) ? JSON.parse(readFileSync(sourcesFile, 'utf8')) :
    { revision: 0, settings: {} };
  let saveQueue = Promise.resolve();
  const tickets = new Map();
  const instanceId = randomBytes(12).toString('hex');
  const attempts = new Map();
  const sign = (value) => createHmac('sha256', key).update(value).digest('base64url');
  const authorized = (req) => {
    if (!requireAuth) return true;
    if (equal(req.headers.authorization, `Bearer ${key}`)) return true;
    const cookie = req.headers.authorization?.startsWith('NAS-Session ')
      ? req.headers.authorization.slice(12)
      : req.headers.cookie?.split(';').map(s => s.trim())
      .find(s => s.startsWith('alger_nas='))?.slice(10);
    if (!cookie) return false;
    const [expires, signature] = cookie.split('.');
    return Number(expires) > Date.now() && equal(signature, sign(expires));
  };

  const inspectAudio = async (value, depth = 0) => {
    if (depth > 2) throw fail('音频地址嵌套过多');
    const upstream = await open(value, { headers: { Range: 'bytes=0-8191' }, timeout: 20000 });
    if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
      upstream.destroy(); throw fail(`音频服务器返回 ${upstream.statusCode}`, 502);
    }
    const bytes = await readBody(upstream, 64 * 1024, true);
    const text = bytes.toString('utf8').trimStart();
    if (text.startsWith('{')) {
      let result;
      try { result = JSON.parse(text); } catch { throw fail('音源返回无效 JSON'); }
      const url = result.url || result.data?.url || result.audio_url || result.link || result.src;
      if (typeof url !== 'string') throw fail('音源响应中没有音频地址');
      return inspectAudio(new URL(url, value).href, depth + 1);
    }
    return { url: value, ...detectAudio(bytes, upstream.headers['content-type']) };
  };

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
      const route = url.pathname;
      if (route === '/health') return json(res, 200, { status: 'ok', version: '0.3.4', lx: 'worker' });
      if (route === '/nas/status') return json(res, 200, { authorized: authorized(req), authRequired: requireAuth, version: '0.3.4', instanceId, sourceRevision: authorized(req) ? sourceState.revision : undefined });
      if (route.startsWith('/nas/')) {
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
          throw fail('不允许跨站请求', 403);
        if (route === '/nas/cover' && ['GET', 'HEAD'].includes(req.method)) {
          const cover = await loadCover(url.searchParams.get('url'));
          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.setHeader('ETag', cover.etag);
          if (req.headers['if-none-match'] === cover.etag) { res.writeHead(304); res.end(); return; }
          res.writeHead(200, { 'Content-Type': cover.type, 'Content-Length': cover.bytes.length });
          res.end(req.method === 'HEAD' ? undefined : cover.bytes); return;
        }
        if (route === '/nas/login' && req.method === 'POST') {
          const ip = req.socket.remoteAddress;
          const prior = attempts.get(ip);
          const attempt = prior && prior.until > Date.now() ? prior : { count: 0, until: Date.now() + 60000 };
          attempts.set(ip, attempt);
          if (++attempt.count > 10) throw fail('尝试次数过多，请稍后再试', 429);
          const body = JSON.parse((await readBody(req, 4096)).toString());
          if (!equal(body.key, key)) throw fail('NAS 访问密钥不正确', 401);
          attempts.delete(ip);
          const expires = String(Date.now() + 30 * 86400000);
          res.setHeader('Set-Cookie', `alger_nas=${expires}.${sign(expires)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`);
          return json(res, 200, { authorized: true, session: `${expires}.${sign(expires)}` });
        }
        if (route.startsWith('/nas/audio/') && ['GET', 'HEAD'].includes(req.method)) {
          const id = route.split('/')[3];
          const ticket = tickets.get(id);
          if (!ticket || ticket.expires < Date.now()) throw fail('播放地址已过期，请重新播放', 410);
          const upstream = await open(ticket.url, { method: req.method,
            headers: req.headers.range ? { Range: req.headers.range } : {}, timeout: 60000 });
          const headers = { 'Content-Type': ticket.mime, 'Cache-Control': 'private, no-store' };
          for (const header of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'])
            if (upstream.headers[header]) headers[header] = upstream.headers[header];
          res.writeHead(upstream.statusCode, headers);
          res.on('close', () => upstream.destroy());
          await pipeline(upstream, res); return;
        }
        if (!authorized(req)) throw fail('请在音源设置中连接 NAS', 401);
        if (route.startsWith('/nas/catalog/') && req.method === 'GET') {
          if (route === '/nas/catalog/diagnostics') return json(res, 200, { issues: catalog.diagnostics() });
          const args = { platform: url.searchParams.get('platform'), type: url.searchParams.get('type'),
            keyword: url.searchParams.get('keyword') || url.searchParams.get('q'), limit: url.searchParams.get('limit') || 30,
            offset: url.searchParams.get('offset') || 0, kind: url.searchParams.get('kind'), id: url.searchParams.get('id') };
          if (route === '/nas/catalog/search') return json(res, 200, await catalog.search(args));
          if (route === '/nas/catalog/detail') return json(res, 200, await catalog.detail(args));
          if (route === '/nas/catalog/lyric') return json(res, 200, await catalog.lyric(args));
          throw fail('搜索接口不存在', 404);
        }
        if (route === '/nas/sources' && req.method === 'GET') return json(res, 200, sourceState);
        if (route === '/nas/sources' && req.method === 'PUT') {
          const body = JSON.parse((await readBody(req, 16 * 1024 * 1024)).toString());
          const operation = saveQueue.then(async () => {
            if (body.revision !== sourceState.revision) throw fail('其他设备已修改音源，请重新连接后再保存', 409);
            const settings = Object.fromEntries(sourceKeys.filter(k => k in (body.settings || {}))
              .map(k => [k, body.settings[k]]));
            const scripts = settings.lxMusicScripts || [];
            if (!Array.isArray(scripts) || scripts.length > 20 || scripts.some(s =>
              typeof s.id !== 'string' || typeof s.script !== 'string' || Buffer.byteLength(s.script) > 2 * 1024 * 1024))
              throw fail('无效的音源列表，最多 20 个脚本，每个不超过 2 MB');
            if ('lxAutoSwitch' in settings && typeof settings.lxAutoSwitch !== 'boolean')
              throw fail('自动切换设置必须为开或关');
            if ('lxMusicPriority' in settings && (!Array.isArray(settings.lxMusicPriority) ||
              settings.lxMusicPriority.length > 20 || settings.lxMusicPriority.some(id => typeof id !== 'string')))
              throw fail('无效的音源优先级列表');
            const next = { revision: sourceState.revision + 1, settings };
            const temporary = sourcesFile + '.tmp';
            await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
            await rename(temporary, sourcesFile);
            sourceState = next;
          });
          saveQueue = operation.catch(() => {});
          await operation;
          return json(res, 200, { revision: sourceState.revision });
        }
        if (route === '/nas/lx/http' && req.method === 'POST') {
          const body = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString());
          const options = body.options || {};
          const method = String(options.method || 'GET').toUpperCase();
          if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw fail('不支持的请求方法');
          let payload = options.body;
          const headers = { ...options.headers };
          if (options.form) {
            payload = new URLSearchParams(options.form).toString();
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
          } else if (options.formData) {
            const form = new FormData();
            for (const [name, value] of Object.entries(options.formData)) form.append(name, String(value));
            const encoded = new Request('http://localhost', { method: 'POST', body: form });
            payload = Buffer.from(await encoded.arrayBuffer());
            headers['Content-Type'] = encoded.headers.get('content-type');
          } else if (payload && typeof payload === 'object') {
            payload = JSON.stringify(payload); headers['Content-Type'] ||= 'application/json';
          }
          const upstream = await open(body.url, { method, headers, body: payload, timeout: options.timeout });
          const bytes = await readBody(upstream);
          let value = bytes.toString('utf8');
          try { value = JSON.parse(value); } catch { /* Text responses are part of the LX protocol. */ }
          return json(res, 200, { statusCode: upstream.statusCode, headers: upstream.headers, body: value });
        }
        if (route === '/nas/audio' && req.method === 'POST') {
          const body = JSON.parse((await readBody(req, 16384)).toString());
          const audio = await inspectAudio(body.url);
          for (const [id, ticket] of tickets) if (ticket.expires < Date.now()) tickets.delete(id);
          if (tickets.size >= 2048) tickets.delete(tickets.keys().next().value);
          const id = randomBytes(24).toString('base64url');
          tickets.set(id, { ...audio, expires: Date.now() + 86400000 });
          return json(res, 200, { url: `/nas/audio/${id}/audio.${audio.codec}`, codec: audio.codec });
        }
        throw fail('接口不存在', 404);
      }
      if (route.startsWith('/api/')) {
        const upstream = http.request({ host: '127.0.0.1', port: apiPort,
          path: req.url.slice(4), method: req.method,
          headers: { ...req.headers, host: `127.0.0.1:${apiPort}` } }, response => {
          const headers = { ...response.headers };
          for (const header of Object.keys(headers)) if (header.startsWith('access-control-')) delete headers[header];
          res.writeHead(response.statusCode, headers);
          response.on('error', () => res.destroy());
          response.pipe(res);
        });
        upstream.on('error', () => { if (!res.headersSent) json(res, 502, { error: '网易云 API 尚未就绪' }); });
        upstream.setTimeout(30000, () => upstream.destroy());
        res.on('close', () => upstream.destroy());
        req.pipe(upstream); return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw fail('不支持的请求方法', 405);
      const relative = decodeURIComponent(route).replace(/^\/+/, '');
      let filename = path.resolve(staticDir, relative || 'index.html');
      if (!filename.startsWith(path.resolve(staticDir) + path.sep)) throw fail('无效路径', 403);
      let info;
      try { info = await stat(filename); } catch { /* SPA routes use the entry document. */ }
      if (!info?.isFile()) {
        if (path.extname(relative)) throw fail('文件不存在', 404);
        filename = path.join(staticDir, 'index.html');
      }
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
        '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
        '.woff2': 'font/woff2', '.woff': 'font/woff', '.webp': 'image/webp', '.wasm': 'application/wasm' };
      res.setHeader('Content-Type', types[path.extname(filename)] || 'application/octet-stream');
      res.setHeader('Cache-Control', filename.endsWith('index.html') || filename.endsWith('sw.js')
        ? 'no-store' : 'public, max-age=86400');
      if (req.method === 'HEAD') { res.end(); return; }
      await pipeline(createReadStream(filename), res);
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 502,
        { error: error instanceof SyntaxError ? '请求数据格式不正确' : error.message });
      else res.destroy();
    }
  });
  server.requestTimeout = 65000;
  server.headersTimeout = 10000;
  return server;
}

async function start() {
  const catalogChild = await startCatalogRuntime(process.env.DATA_DIR || path.join(root, 'nas-data'));
  const apiPort = Number(process.env.NCM_API_PORT || 3001);
  const anonymousToken = path.join(os.tmpdir(), 'anonymous_token');
  if (!existsSync(anonymousToken)) writeFileSync(anonymousToken, '', { mode: 0o600 });
  const require = createRequire(import.meta.url);
  const ncm = require('netease-cloud-music-api-alger/server');
  await ncm.serveNcmApi({ host: '127.0.0.1', port: apiPort,
    moduleDefs: await createNcmModules(require) });
  const server = createNasServer({ apiPort,
    dataDir: process.env.DATA_DIR || path.join(root, 'nas-data'),
    accessKey: process.env.NAS_ACCESS_KEY,
    staticDir: process.env.STATIC_DIR || path.join(root, 'out/nas') });
  server.listen(Number(process.env.PORT || 8080), process.env.HOST || '0.0.0.0', () =>
    console.log(`alger-music 0.3.4 listening on ${server.address().port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () =>
    server.close(() => { catalogChild?.kill(); process.exit(0); }));
  process.on('exit', () => catalogChild?.kill());
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch(error => { console.error('Alger NAS startup failed:', error.message); process.exit(1); });
}
