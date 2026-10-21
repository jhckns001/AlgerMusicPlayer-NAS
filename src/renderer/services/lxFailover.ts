import type { LxMusicInfo, LxMusicScriptConfig, LxQuality, LxSourceConfig, LxSourceKey } from '../types/lxMusic';

export interface LxFailoverSettings {
  lxMusicScripts?: LxMusicScriptConfig[];
  activeLxMusicApiId?: string | null;
  lxAutoSwitch?: boolean;
  lxMusicPriority?: string[];
}

export function orderedLxScripts(settings: LxFailoverSettings): LxMusicScriptConfig[] {
  const scripts = settings.lxMusicScripts || [];
  // Existing instances keep their selected source first on upgrade.
  const order = settings.lxMusicPriority?.length ? settings.lxMusicPriority :
    [settings.activeLxMusicApiId || '', ...scripts.map(script => script.id)];
  const ids = [...new Set([...order, ...scripts.map(script => script.id)])];
  return ids.map(id => scripts.find(script => script.id === id))
    .filter((script): script is LxMusicScriptConfig => Boolean(script));
}

export function lxCandidates(settings: LxFailoverSettings, source: LxSourceKey = 'wy'): LxMusicScriptConfig[] {
  const scripts = orderedLxScripts(settings).filter(script =>
    script.enabled !== false && Boolean(script.script) && script.sources?.includes(source));
  return settings.lxAutoSwitch !== false ? scripts :
    scripts.filter(script => script.id === settings.activeLxMusicApiId);
}

export function lxPlanSignature(settings: LxFailoverSettings, source: LxSourceKey = 'wy'): string {
  // Only a fingerprint enters URL cache metadata; never script contents.
  let hash = 2166136261;
  const plan = JSON.stringify([settings.lxAutoSwitch !== false,
    source, lxCandidates(settings, source).map(script => [script.id, script.name, script.script])]);
  for (let i = 0; i < plan.length; i++) hash = Math.imul(hash ^ plan.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

export interface FailoverRunner {
  initialize(): Promise<unknown>;
  getSources(): Partial<Record<string, LxSourceConfig>>;
  getMusicUrl(source: LxSourceKey, info: LxMusicInfo, quality: LxQuality): Promise<string>;
  dispose(): void;
}

export interface LxResolution {
  url: string;
  quality: LxQuality;
  scriptId: string;
  scriptName: string;
}

class AttemptTimeout extends Error {}

export async function resolveLxFailover({ settings, musicInfo, quality = 'flac',
  createRunner, probe, attemptMs = 12000, totalMs = 45000 } : {
  settings: LxFailoverSettings;
  musicInfo: LxMusicInfo;
  quality?: LxQuality;
  createRunner: (script: LxMusicScriptConfig) => FailoverRunner;
  probe: (url: string, quality: LxQuality, signal: AbortSignal) => Promise<string>;
  attemptMs?: number;
  totalMs?: number;
}): Promise<LxResolution> {
  const sourceKey = (musicInfo.source || 'wy') as LxSourceKey;
  const candidates = lxCandidates(settings, sourceKey);
  if (!candidates.length) throw new Error('没有启用且支持当前平台的音源，请在音源设置中检查');
  const levels: LxQuality[] = ['flac24bit', 'flac', '320k', '128k'];
  const qualities = levels.slice(Math.max(0, levels.indexOf(quality)));
  const runners = new Map<string, FailoverRunner>();
  const blocked = new Set<string>();
  const deadline = Date.now() + totalMs;
  try {
    // Quality comes first: try every enabled source at FLAC before lowering it.
    for (const target of qualities) {
      for (const script of candidates) {
        if (blocked.has(script.id)) continue;
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('音源解析超过总等待时间，请重试或调整音源优先级');
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let runner = runners.get(script.id);
        let initializing = !runner;
        try {
          if (!runner) {
            runner = createRunner(script);
            runners.set(script.id, runner);
          }
          const current = runner;
          const task = async (): Promise<string | null> => {
            if (initializing) await current.initialize();
            if (controller.signal.aborted) throw new AttemptTimeout();
            initializing = false;
            const source = current.getSources()[sourceKey];
            if (!source?.actions.includes('musicUrl')) { blocked.add(script.id); return null; }
            if (!source.qualitys.includes(target)) return null;
            const raw = await current.getMusicUrl(sourceKey, musicInfo, target);
            if (controller.signal.aborted) throw new AttemptTimeout();
            return probe(raw, target, controller.signal);
          };
          const url = await Promise.race([task(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new AttemptTimeout());
            }, Math.min(attemptMs, remaining));
          })]);
          if (url) return { url, quality: target, scriptId: script.id, scriptName: script.name };
        } catch (error) {
          // Do not repeatedly wait on a hung/broken script at each lower quality.
          if (initializing || error instanceof AttemptTimeout) {
            blocked.add(script.id);
            runner?.dispose();
            runners.delete(script.id);
          }
        } finally {
          if (timer) clearTimeout(timer);
          controller.abort();
        }
      }
    }
    throw new Error('已尝试所有启用音源及可用音质，仍未找到可播放音频');
  } finally {
    // Each song owns its runners; preloading another song cannot destroy them.
    for (const runner of runners.values()) runner.dispose();
  }
}
