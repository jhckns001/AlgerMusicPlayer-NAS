// Local integration fixture only; never included in the NAS deployment bundle.
import http from 'node:http';
import { Readable } from 'node:stream';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNasServer } from '../server.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = path.join(root, process.env.FAILOVER_FIXTURE === '1' ? 'nas-failover-fixture-data' : 'nas-fixture-data');
mkdirSync(directory, { recursive: true });
const samples = 16000 * 2;
const wave = Buffer.alloc(44 + samples * 2);
wave.write('RIFF', 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(16000, 24); wave.writeUInt32LE(32000, 28); wave.writeUInt16LE(2, 32);
wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) wave.writeInt16LE(Math.round(500 * Math.sin(i / 16000 * 440 * 2 * Math.PI)), 44 + i * 2);
const song = { id: 99000001, name: 'NAS 集成测试（模拟音频）', fee: 1, dt: 2000,
  ar: [{ id: 1, name: '本机测试' }], al: { id: 2, name: '本机测试', picUrl: '' },
  artists: [{ id: 1, name: '本机测试' }], album: { id: 2, name: '本机测试', picUrl: '' },
  privilege: { st: 0, pl: 0, dl: 0, fee: 1 }, duration: 2000 };
const api = http.createServer((req, res) => {
  const route = new URL(req.url, 'http://localhost').pathname;
  let result = { code: 200, data: [], result: [], banners: [] };
  if (['/cloudsearch', '/search'].includes(route)) result = { code: 200, result: { songs: [song], songCount: 1 } };
  if (route === '/song/detail') result = { code: 200, songs: [song], privileges: [song.privilege] };
  if (route.includes('/song/url')) result = { code: 200, data: [{ id: song.id, url: null, fee: 1 }] };
  if (route.includes('lyric')) result = { code: 200, lrc: { lyric: '[00:00.00]本机模拟测试音频' } };
  if (route.includes('login/status')) result = { data: { code: 200, account: null, profile: null } };
  if (route === '/user/detail') result = { code: 200, profile: {
    userId: 900001, nickname: '本机布局测试', avatarUrl: '', vipType: 0
  }, level: 1 };
  if (route === '/user/playlist') result = { code: 200, playlist: [], more: false };
  if (route === '/personal_fm') result = { code: 200, data: [song] };
  if (route === '/recommend/songs') result = { code: 200, data: { dailySongs: [song] } };
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result));
});
await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
const attempts = [];
const open = async (value, options = {}) => {
  const url = new URL(value);
  if (url.hostname !== 'alger-fixture.invalid') throw new Error('本机测试源只能请求模拟服务器');
  attempts.push({ path: url.pathname, source: url.searchParams.get('source'), quality: url.searchParams.get('quality'), range: options.headers?.Range });
  writeFileSync(path.join(directory, 'requests.json'), JSON.stringify(attempts, null, 2));
  let bytes = wave, headers = { 'content-type': 'audio/wav' }, statusCode = 200;
  if (url.pathname === '/resolve') {
    const source = url.searchParams.get('source');
    statusCode = source === 'A' ? 503 : source === 'B' ? 200 : url.searchParams.get('quality') === 'flac' ? 404 : 200;
    bytes = Buffer.from(JSON.stringify(statusCode === 200 ? { url: 'https://alger-fixture.invalid/audio' } : { error: '高音质不可用' }));
    headers = { 'content-type': 'application/json' };
  } else if (options.headers?.Range) {
    const [, start, end] = /bytes=(\d+)-(\d*)/.exec(options.headers.Range);
    const first = Number(start), last = Math.min(Number(end || wave.length - 1), wave.length - 1);
    bytes = wave.subarray(first, last + 1); statusCode = 206;
    headers['content-range'] = `bytes ${first}-${last}/${wave.length}`;
  }
  const response = Readable.from([bytes]); response.statusCode = statusCode;
  response.headers = { ...headers, 'content-length': String(bytes.length), 'accept-ranges': 'bytes' };
  return response;
};
const server = createNasServer({ dataDir: directory, apiPort: api.address().port,
  accessKey: 'local-test-only', open });
const previewPort = Number(process.env.PREVIEW_PORT || 18082);
server.listen(previewPort, '127.0.0.1', () => console.log(`Integration fixture: http://127.0.0.1:${previewPort}`));
