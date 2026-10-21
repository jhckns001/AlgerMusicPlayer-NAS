import { LxMusicSourceRunner } from '@/services/LxMusicSourceRunner';
import { lxPlanSignature, resolveLxFailover } from '@/services/lxFailover';
import { nasAudioUrl, nasInstanceId, nasLastLxResolution, waitNasSources } from '@/services/nasClient';
import { useSettingsStore } from '@/store';
import { QUALITY_TO_LX, type LxSourceKey } from '@/types/lxMusic';
import type { SongResult } from '@/types/music';

const cache = new Map<string, { url: string; expires: number }>();
const pending = new Map<string, Promise<string>>();
export const isCatalogSong = (song: SongResult) => Boolean(song.source && song.source !== 'netease');

export async function resolveCatalogSong(song: SongResult): Promise<string> {
  if (!song.lxMusicInfo || !song.platformId || !String(song.id).startsWith(`${song.source}:`))
    throw new Error('歌曲信息不完整，请重新搜索这首歌');
  useSettingsStore();
  await waitNasSources();
  const currentSettings = useSettingsStore().setData;
  const quality = QUALITY_TO_LX[currentSettings.musicQuality || 'lossless'] || 'flac';
  const key = JSON.stringify([song.id, quality, nasInstanceId.value,
    lxPlanSignature(currentSettings, song.lxMusicInfo.source as LxSourceKey)]);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.url;
  if (pending.has(key)) return pending.get(key)!;
  const task = resolveLxFailover({ settings: currentSettings,
    musicInfo: JSON.parse(JSON.stringify(song.lxMusicInfo)), quality,
    createRunner: script => new LxMusicSourceRunner(script.script),
    probe: async (raw, target, signal) => {
      const result = await nasAudioUrl(raw, target, signal);
      return new URL(result.url, window.location.origin).href;
    }
  }).then(result => {
    nasLastLxResolution.value = { song: song.name, source: result.scriptName, quality: result.quality };
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, { url: result.url, expires: Date.now() + 5 * 60 * 1000 });
    return result.url;
  }).finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}
