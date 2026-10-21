import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createNcmModules } from '../ncm-login.mjs';

const modules = await createNcmModules(createRequire(import.meta.url));
const create = modules.find(entry => entry.route === '/login/qr/create').module;
const check = modules.find(entry => entry.route === '/login/qr/check').module;

test('QR create encodes the Netease login URL as a PNG instead of the upstream warning image', async () => {
  const result = await create({ key: 'fixture-login-key', qrimg: true });
  assert.equal(result.body.data.qrurl, 'https://music.163.com/login?codekey=fixture-login-key');
  assert.match(result.body.data.qrimg, /^data:image\/png;base64,/);
  const png = Buffer.from(result.body.data.qrimg.split(',')[1], 'base64');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 300);
  assert.equal(png.readUInt32BE(20), 300);
});

test('QR checks preserve waiting/scanned/confirmed/expired states and confirmed login cookies', async () => {
  for (const code of [800, 801, 802, 803]) {
    const result = await check({ key: 'fixture-login-key' }, async (route, data) => {
      assert.equal(route, '/api/login/qrcode/client/login');
      assert.deepEqual(data, { key: 'fixture-login-key', type: 3 });
      return { body: { code }, cookie: code === 803 ? ['MUSIC_U=fixture-only'] : [] };
    });
    assert.equal(result.body.code, code);
    assert.equal(result.body.cookie, code === 803 ? 'MUSIC_U=fixture-only' : '');
  }
});

test('QR expiry errors remain visible; network errors are reported without leaking response data', async () => {
  const expired = await check({}, async () => { throw { body: { code: 800 }, cookie: [] }; });
  assert.equal(expired.body.code, 800);
  await assert.rejects(check({}, async () => { throw new Error('private-upstream-details'); }), error => {
    assert.equal(error.status, 502);
    assert.equal(error.body.code, 502);
    assert.equal(JSON.stringify(error).includes('private-upstream-details'), false);
    return true;
  });
});
