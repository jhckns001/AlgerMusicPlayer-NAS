import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogService, normalizeCatalogTrack } from '../catalog.mjs';
import { lxCandidates, resolveLxFailover } from '../../src/renderer/services/lxFailover.ts';

const track = (platform, extensions = {}) => ({ id: '123', platform, name: '<em>歌曲</em>',
  artists: [{ ref: `${platform}:artist`, name: '歌手' }], album: { ref: `${platform}:album`, name: '专辑' },
  duration_ms: 120000, available_qualities: ['lossless'], extensions });

test('platform IDs remain isolated and QQ, Kugou retain LX identifiers', () => {
  const qq = normalizeCatalogTrack(track('qq', { numeric_id: 456, media_mid: 'media' }), 'qq');
  const kg = normalizeCatalogTrack(track('kugou', { hash: 'ABC', qualities: { lossless: { hash: 'DEF', size: 99 } } }), 'kugou');
  assert.notEqual(qq.id, kg.id); assert.equal(qq.name, '歌曲');
  assert.equal(qq.lxMusicInfo.songId, 456); assert.equal(qq.lxMusicInfo.strMediaMid, 'media');
  assert.equal(kg.lxMusicInfo.songmid, 'abc'); assert.equal(kg.lxMusicInfo._types.flac.hash, 'DEF');
  assert.equal(kg.lxMusicInfo.types.find(q => q.type === 'flac').hash, 'DEF');
  assert.throws(() => normalizeCatalogTrack(track('migu'), 'migu'), /不支持/);
  assert.throws(() => normalizeCatalogTrack(track('qq'), 'kugou'), /平台/);
});

test('all four categories preserve pagination; identical requests share a cached result', async () => {
  let calls = 0;
  const service = createCatalogService({ request: async url => {
    calls++;
    const kind = url.searchParams.get('type');
    const entity = kind === 'track' ? track('qq') : { id: '123', name: '结果', artists: [] };
    return Response.json({ ok: true, data: [{ type: kind, data: entity }], meta: { pagination: { has_more: true, next_offset: 60 } } });
  } });
  for (const [type, key] of [[1, 'songs'], [10, 'albums'], [1000, 'playlists'], [100, 'artists']]) {
    const args = { platform: 'qq', type, keyword: '测试', offset: 30 };
    const result = await service.search(args);
    assert.equal(result.result[key][0].id, 'qq:123'); assert.equal(result.result.nextOffset, 60);
    await service.search(args);
  }
  assert.equal(calls, 4);
  await assert.rejects(service.search({ platform: 'soda', type: 1, keyword: '测试' }), /不支持/);
  await assert.rejects(service.detail({ platform: 'qq', kind: 'account', id: '1' }), /参数/);
});

test('foreign songs choose their own platform and fail over at FLAC', async () => {
  const scripts = ['A', 'B'].map(id => ({ id, name: id, script: id, enabled: true, sources: ['tx'] }));
  const settings = { lxMusicScripts: scripts, lxAutoSwitch: true };
  assert.equal(lxCandidates(settings).length, 0); assert.equal(lxCandidates(settings, 'tx').length, 2);
  const calls = [];
  const result = await resolveLxFailover({ settings, musicInfo: { songmid: 'mid', name: '歌', singer: '人', source: 'tx' },
    createRunner: script => ({ initialize: async () => {}, dispose() {},
      getSources: () => ({ tx: { actions: ['musicUrl'], qualitys: ['flac', '320k'] } }),
      getMusicUrl: async (source, info, quality) => { calls.push([script.id, source, info.songmid, quality]);
        if (script.id === 'A') throw new Error('forced'); return 'https://audio.example/b'; } }), probe: async url => url });
  assert.equal(result.scriptId, 'B'); assert.deepEqual(calls, [['A', 'tx', 'mid', 'flac'], ['B', 'tx', 'mid', 'flac']]);
});
