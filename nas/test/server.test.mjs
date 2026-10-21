import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createNasServer } from '../server.mjs';
import { isPublicAddress, publicTarget, detectAudio } from '../network.mjs';

test('private, mapped and reserved targets are rejected; public targets are accepted', async () => {
  for (const ip of ['127.0.0.1', '192.168.1.123', '10.1.1.1', '169.254.169.254',
    '172.16.0.1', '100.64.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', 'fe80::1', 'fc00::1'])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('1.1.1.1'), true);
  await assert.rejects(publicTarget('file:///etc/passwd'));
  await assert.rejects(publicTarget('http://user:pass@example.com'));
  await assert.rejects(publicTarget('https://music.example', async () => [
    { address: '1.1.1.1', family: 4 }, { address: '127.0.0.1', family: 4 }
  ]));
});

test('HTML and JSON masquerading as audio are rejected; actual signatures win over MIME', () => {
  assert.equal(detectAudio(Buffer.from('fLaCdata'), 'text/plain').codec, 'flac');
  assert.equal(detectAudio(Buffer.from('ID3data'), 'audio/flac').codec, 'mp3');
  assert.throws(() => detectAudio(Buffer.from('<html>error</html>'), 'audio/mpeg'));
});

test('authenticated LX calls, shared configuration and audio Range work without Lemon', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'alger-nas-test-'));
  const audio = Buffer.from('fLaC' + '0123456789'.repeat(1000));
  const requests = [];
  const open = async (url, options = {}) => {
    requests.push({ url, options });
    let bytes = audio, headers = { 'content-type': 'audio/flac' }, statusCode = 200;
    if (url.endsWith('/resolve')) {
      bytes = Buffer.from(JSON.stringify({ data: { url: 'https://audio.example/song' } }));
      headers = { 'content-type': 'application/json' };
    } else if (url.endsWith('/json')) {
      bytes = Buffer.from(JSON.stringify({ url: 'https://audio.example/song' }));
      headers = { 'content-type': 'application/json' };
    } else if (url.endsWith('/bad')) {
      bytes = Buffer.from('<html>login</html>');
    } else if (options.headers?.Range) {
      const [, first, last] = /bytes=(\d+)-(\d*)/.exec(options.headers.Range);
      const from = Number(first), to = Math.min(Number(last || audio.length - 1), audio.length - 1);
      bytes = audio.subarray(from, to + 1); statusCode = 206;
      headers['content-range'] = `bytes ${from}-${to}/${audio.length}`;
    }
    const stream = Readable.from([bytes]);
    stream.statusCode = statusCode;
    stream.headers = { ...headers, 'content-length': String(bytes.length), 'accept-ranges': 'bytes' };
    return stream;
  };
  const server = createNasServer({ dataDir: directory, accessKey: 'test-access', open, requireAuth: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r));
    await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (endpoint, data, method = 'POST', headers = {}) => fetch(base + endpoint, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  assert.equal((await call('/nas/lx/http', {})).status, 401);
  assert.equal((await call('/nas/login', { key: 'wrong' })).status, 401);
  const login = await call('/nas/login', { key: 'test-access' });
  assert.equal(login.status, 200);
  const session = (await login.json()).session;
  assert.equal((await call('/nas/sources', undefined, 'GET', { Authorization: `NAS-Session ${session}` })).status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const auth = { Cookie: cookie };
  assert.equal((await call('/nas/status', undefined, 'GET', auth)).status, 200);
  const settings = { musicQuality: 'lossless', lxMusicScripts: [{ id: 'demo', script: 'lx.on(...)' }],
    activeLxMusicApiId: 'demo', enableMusicUnblock: true, enabledMusicSources: ['lxMusic'] };
  assert.equal((await call('/nas/sources', { revision: 0, settings }, 'PUT', auth)).status, 200);
  assert.equal((await (await call('/nas/status', undefined, 'GET', auth)).json()).sourceRevision, 1);
  assert.equal((await call('/nas/sources', { revision: 0, settings }, 'PUT', auth)).status, 409);
  const saved = JSON.parse(await readFile(path.join(directory, 'sources.json'), 'utf8'));
  assert.equal(saved.settings.lxMusicScripts[0].id, 'demo');
  const secondDevice = await call('/nas/sources', undefined, 'GET', { Authorization: 'Bearer test-access' });
  assert.deepEqual((await secondDevice.json()).settings, settings);
  const result = await call('/nas/lx/http', { url: 'https://audio.example/resolve',
    options: { method: 'POST', form: { songId: '22688484' } } }, 'POST', auth);
  assert.equal((await result.json()).body.data.url, 'https://audio.example/song');
  assert.equal(requests.at(-1).options.body, 'songId=22688484');
  assert.equal((await call('/nas/audio', { url: 'https://audio.example/bad' }, 'POST', auth)).status, 502);
  const prepared = await call('/nas/audio', { url: 'https://audio.example/json' }, 'POST', auth);
  const ticket = await prepared.json();
  assert.match(ticket.url, /^\/nas\/audio\/[\w-]+\/audio\.flac$/);
  assert.equal(ticket.url.includes('https://audio.example'), false);
  const range = await fetch(base + ticket.url, { headers: { Range: 'bytes=4-9' } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-type'), 'audio/flac');
  assert.equal(range.headers.get('content-range'), `bytes 4-9/${audio.length}`);
  assert.equal(await range.text(), '012345');
  assert.equal((await call('/nas/sources', undefined, 'GET', { ...auth, Origin: 'https://untrusted.example' })).status, 403);
});

test('LAN preview permits direct source access without a key and still rejects cross-site writes', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'alger-nas-open-test-'));
  const server = createNasServer({ dataDir: directory, requireAuth: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r));
    await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const status = await (await fetch(base + '/nas/status')).json();
  assert.equal(status.authorized, true);
  assert.equal(status.authRequired, false);
  assert.equal((await fetch(base + '/nas/sources')).status, 200);
  const settings = { lxAutoSwitch: true, lxMusicPriority: ['B', 'A'],
    lxMusicScripts: [{ id: 'A', script: 'fixture A' }, { id: 'B', script: 'fixture B' }] };
  const saved = await fetch(base + '/nas/sources', { method: 'PUT',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 0, settings }) });
  assert.equal(saved.status, 200);
  assert.deepEqual((await (await fetch(base + '/nas/sources')).json()).settings, settings);
  const invalid = await fetch(base + '/nas/sources', { method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: 1, settings: { ...settings, lxMusicPriority: 'A,B' } }) });
  assert.equal(invalid.status, 400);
  const crossSite = await fetch(base + '/nas/sources', { method: 'PUT',
    headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: 0, settings: {} }) });
  assert.equal(crossSite.status, 403);
});
