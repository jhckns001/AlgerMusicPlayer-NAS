import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedSettings, mergeSettingsDraft } from '../../src/renderer/services/settingsDraft.ts';

test('a delayed form edit does not overwrite newly loaded NAS scripts', () => {
  const initial = { theme: 'light', lxMusicScripts: [], activeLxMusicApiId: null };
  const userEdit = { ...initial, theme: 'dark' };
  const patch = changedSettings(userEdit, initial);
  assert.deepEqual(patch, { theme: 'dark' });
  const remote = { theme: 'light', lxMusicScripts: [{ id: 'A' }, { id: 'B' }], activeLxMusicApiId: 'A' };
  const draft = mergeSettingsDraft(remote, patch);
  assert.deepEqual(draft.lxMusicScripts, remote.lxMusicScripts);
  assert.equal(draft.activeLxMusicApiId, 'A'); assert.equal(draft.theme, 'dark');
  assert.deepEqual({ ...remote, ...patch }, draft);
});

test('source hydration is not a user edit; nested drafts do not mutate store arrays', () => {
  const remote = { lxMusicScripts: [{ id: 'A', enabled: true }], musicQuality: 'lossless' };
  const draft = mergeSettingsDraft(remote, {});
  assert.deepEqual(changedSettings(draft, remote), {});
  draft.musicQuality = 'higher';
  assert.deepEqual(changedSettings(draft, remote), { musicQuality: 'higher' });
  draft.lxMusicScripts[0].enabled = false;
  assert.equal(remote.lxMusicScripts[0].enabled, true);
});
