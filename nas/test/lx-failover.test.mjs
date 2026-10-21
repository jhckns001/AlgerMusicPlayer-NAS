import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lxCandidates, orderedLxScripts, lxPlanSignature, resolveLxFailover } from '../../src/renderer/services/lxFailover.ts';

const script = (id, extra = {}) => ({ id, name: id, script: `script-${id}`, sources: ['wy'], enabled: true, ...extra });
const musicInfo = { songmid: 1, name: '测试歌曲', singer: '测试歌手' };
const settings = (ids = ['A', 'B']) => ({ lxMusicScripts: ids.map(id => script(id)), activeLxMusicApiId: ids[0], lxAutoSwitch: true });
function harness(config, action, extra = {}) {
  const calls = [], disposed = [], initialized = [];
  const options = { settings: config, musicInfo,
    createRunner: entry => ({
      initialize: async () => { initialized.push(entry.id); if (entry.id === extra.badInit) throw new Error('init failed'); },
      getSources: () => ({ wy: { actions: ['musicUrl'], qualitys: extra.qualities?.[entry.id] || ['flac', '320k', '128k'] } }),
      getMusicUrl: async (_, info, quality) => { calls.push(`${entry.id}:${quality}`); return action(entry.id, quality, info); },
      dispose: () => disposed.push(entry.id)
    }),
    probe: extra.probe || (async url => url), ...extra.options
  };
  return { calls, disposed, initialized, options };
}

test('upgrade preserves active source first; disabled/unsupported sources are excluded and explicit order wins', () => {
  const config = settings(['A', 'B', 'C', 'D']);
  config.activeLxMusicApiId = 'B';
  config.lxMusicScripts[2].enabled = false;
  config.lxMusicScripts[3].sources = ['kw'];
  assert.deepEqual(orderedLxScripts(config).map(s => s.id), ['B', 'A', 'C', 'D']);
  config.lxMusicPriority = ['D', 'C', 'A', 'B', 'missing', 'A'];
  assert.deepEqual(lxCandidates(config).map(s => s.id), ['A', 'B']);
});

test('source A FLAC fails and source B takes over at FLAC before A can downgrade', async () => {
  const h = harness(settings(), async (id, quality) => {
    if (id === 'A' && quality === 'flac') throw new Error('forced failure');
    return `https://audio.example/${id}`;
  });
  const result = await resolveLxFailover(h.options);
  assert.deepEqual(h.calls, ['A:flac', 'B:flac']);
  assert.equal(result.scriptId, 'B'); assert.equal(result.quality, 'flac');
  assert.deepEqual(h.disposed, ['A', 'B']);
});

test('all sources exhaust FLAC before ordered downgrade to 320k; unavailable levels are skipped', async () => {
  const h = harness(settings(['A', 'B', 'C']), async (id, quality) => {
    if (quality === 'flac') throw new Error('no flac');
    return `https://audio.example/${id}`;
  }, { qualities: { C: ['128k'] } });
  const result = await resolveLxFailover(h.options);
  assert.deepEqual(h.calls, ['A:flac', 'B:flac', 'A:320k']);
  assert.equal(result.quality, '320k');
});

test('manual mode never uses a backup; invalid audio is rejected before a source succeeds', async () => {
  const manual = settings(); manual.lxAutoSwitch = false;
  const h = harness(manual, async () => { throw new Error('failed'); });
  await assert.rejects(resolveLxFailover(h.options), /所有启用音源/);
  assert.deepEqual(h.calls, ['A:flac', 'A:320k', 'A:128k']);
  const probe = harness(settings(), async id => id, { probe: async url => {
    if (url === 'A') throw new Error('HTML is not audio'); return url;
  } });
  assert.equal((await resolveLxFailover(probe.options)).scriptId, 'B');
});

test('initialization errors and timeouts skip the broken source and release its runner', async () => {
  const init = harness(settings(), async id => id, { badInit: 'A' });
  assert.equal((await resolveLxFailover(init.options)).scriptId, 'B');
  assert.deepEqual(init.calls, ['B:flac']);
  assert.deepEqual(init.disposed, ['A', 'B']);
  const hang = harness(settings(), async id => id === 'A' ? new Promise(() => {}) : id,
    { options: { attemptMs: 15, totalMs: 100 } });
  assert.equal((await resolveLxFailover(hang.options)).scriptId, 'B');
  assert.deepEqual(hang.calls, ['A:flac', 'B:flac']);
  assert.deepEqual(hang.disposed, ['A', 'B']);
});

test('total deadline bounds waiting and aborts an in-flight audio probe', async () => {
  let aborted = 0;
  const h = harness(settings(), async id => id, {
    options: { attemptMs: 100, totalMs: 15 },
    probe: async (_, __, signal) => new Promise(() => signal.addEventListener('abort', () => aborted++))
  });
  await assert.rejects(resolveLxFailover(h.options));
  assert.ok(aborted >= 1);
  assert.ok(h.calls.length <= 2);
});

test('concurrent songs own separate runners and cannot cancel one another', async () => {
  let disposed = 0;
  const run = id => resolveLxFailover({ settings: settings(['A']), musicInfo: { ...musicInfo, songmid: id },
    createRunner: () => { let closed = false; return {
      initialize: async () => {}, getSources: () => ({ wy: { actions: ['musicUrl'], qualitys: ['flac'] } }),
      getMusicUrl: async (_, info) => { await new Promise(r => setTimeout(r, id === 1 ? 15 : 1));
        assert.equal(closed, false); return String(info.songmid); },
      dispose: () => { closed = true; disposed++; }
    }; }, probe: async url => url });
  assert.deepEqual((await Promise.all([run(1), run(2)])).map(r => r.url), ['1', '2']);
  assert.equal(disposed, 2);
});

test('priority, enablement, manual mode and script changes invalidate cached playback plans', () => {
  const config = settings();
  const fingerprints = [lxPlanSignature(config)];
  config.lxMusicPriority = ['B', 'A']; fingerprints.push(lxPlanSignature(config));
  config.lxMusicScripts[0].enabled = false; fingerprints.push(lxPlanSignature(config));
  config.lxAutoSwitch = false; fingerprints.push(lxPlanSignature(config));
  config.lxAutoSwitch = true; config.lxMusicScripts[1].script += '-updated'; fingerprints.push(lxPlanSignature(config));
  assert.equal(new Set(fingerprints).size, fingerprints.length);
});
