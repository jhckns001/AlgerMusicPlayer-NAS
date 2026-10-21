import { ref, watch } from 'vue';

export const isNasMode = import.meta.env.VITE_NAS_MODE === 'true';
export const nasConnected = ref(false);
export const nasSourcesReady = ref(false);
export const nasDefaultSourceSettings = {
  lxMusicScripts: [], activeLxMusicApiId: null, enableMusicUnblock: true,
  enabledMusicSources: ['lxMusic'], musicQuality: 'lossless', lxAutoSwitch: true, lxMusicPriority: []
};
export async function waitNasSources() {
  if (nasSourcesReady.value) return;
  await refreshNasConnection();
  if (!nasConnected.value) throw new Error('未能连接 NAS，请刷新页面后重试');
  if (nasSourcesReady.value) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { stop(); reject(new Error('音源配置尚未读取完成，请稍后重试')); }, 10000);
    const stop = watch(nasSourcesReady, ready => { if (ready) { clearTimeout(timer); stop(); resolve(); } });
  });
}
export const nasAuthRequired = ref(false);
export const nasConnectionRevision = ref(0);
export const nasInstanceId = ref('');
export const nasSyncError = ref('');
export const nasLastLxResolution = ref<{ song: string; source: string; quality: string } | null>(null);
export const nasSourceKeys = [
  'lxMusicScripts', 'activeLxMusicApiId', 'enableMusicUnblock',
  'enabledMusicSources', 'musicQuality', 'lxAutoSwitch', 'lxMusicPriority'
] as const;

export async function nasRequest<T>(path: string, body?: unknown, method?: string, signal?: AbortSignal): Promise<T> {
  const session = sessionStorage.getItem('algerNasSession');
  const response = await fetch(`/nas/${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    credentials: 'same-origin',
    signal,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(session ? { Authorization: `NAS-Session ${session}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) nasConnected.value = false;
    throw new Error(result.error || `NAS 请求失败 (${response.status})`);
  }
  return result as T;
}

export async function refreshNasConnection() {
  if (!isNasMode) return;
  try {
    const status = await nasRequest<{ authorized: boolean; authRequired: boolean; instanceId: string }>('status');
    nasAuthRequired.value = status.authRequired;
    const changedInstance = Boolean(nasInstanceId.value && nasInstanceId.value !== status.instanceId);
    nasInstanceId.value = status.instanceId;
    nasConnected.value = status.authorized;
    if (changedInstance) nasConnectionRevision.value++;
  } catch {
    nasConnected.value = false;
  }
}

export async function reloadNasSources() {
  await refreshNasConnection();
  nasConnectionRevision.value++;
  await waitNasSources();
}

export async function connectNas(key: string) {
  const result = await nasRequest<{ session: string }>('login', { key });
  sessionStorage.setItem('algerNasSession', result.session);
  nasConnected.value = true;
  nasConnectionRevision.value++;
}

export const nasHttpRequest = (url: string, options: unknown, signal?: AbortSignal) =>
  nasRequest<{ statusCode: number; headers: Record<string, string>; body: any }>(
    'lx/http', { url, options }, 'POST', signal
  );

export const nasAudioUrl = (url: string, quality: string, signal?: AbortSignal) =>
  nasRequest<{ url: string; codec: string }>('audio', { url, quality }, 'POST', signal);

export async function importNasScript(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.js,text/javascript,application/javascript';
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      if (file.size > 2 * 1024 * 1024) return reject(new Error('音源脚本不能超过 2 MB'));
      try { resolve(await file.text()); } catch (error) { reject(error); }
    }, { once: true });
    input.click();
  });
}
