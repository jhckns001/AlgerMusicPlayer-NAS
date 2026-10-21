import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils', () => ({ isElectron: false }));
vi.mock('@/router/home', () => ({ default: [] }));
vi.mock('@/store/modules/menu', () => ({ useMenuStore: () => ({ setMenus: vi.fn() }) }));

describe('NAS source synchronization across mobile lifecycle and pending edits', () => {
  let client: typeof import('../src/renderer/services/nasClient');
  let store: ReturnType<typeof import('../src/renderer/store/modules/settings')['useSettingsStore']>;
  let stop: () => void;
  let dispose: () => void;
  let doc: EventTarget & { visibilityState: string; documentElement: any };
  let win: EventTarget;
  let remote: { revision: number; settings: any };
  let reads: number;
  let writes: number;
  let failRead: boolean;
  let failWrite: boolean;
  let holdWrite: Promise<void> | undefined;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubEnv('VITE_NAS_MODE', 'true');
    const storage = () => {
      const values = new Map<string, string>();
      return { getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value) };
    };
    doc = Object.assign(new EventTarget(), { visibilityState: 'visible', createElement: () => ({ content: {} }),
      documentElement: { classList: { add: vi.fn(), remove: vi.fn() } } });
    win = Object.assign(new EventTarget(), { innerWidth: 390 });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', win);
    vi.stubGlobal('navigator', { userAgent: 'iPhone' });
    vi.stubGlobal('localStorage', storage());
    vi.stubGlobal('sessionStorage', storage());
    remote = { revision: 3, settings: { lxMusicScripts: [{ id: 'fixture-A', script: 'synthetic' }],
      activeLxMusicApiId: 'fixture-A', musicQuality: 'lossless' } };
    reads = writes = 0;
    failRead = failWrite = false;
    holdWrite = undefined;
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (url === '/nas/status') return Response.json({ authorized: true, authRequired: false,
        instanceId: 'fixture-instance', sourceRevision: remote.revision });
      if (url === '/nas/sources' && options.method === 'GET') {
        reads++;
        if (failRead) { failRead = false; throw new Error('temporary read failure'); }
        return Response.json(remote);
      }
      if (url === '/nas/sources' && options.method === 'PUT') {
        writes++;
        if (holdWrite) await holdWrite;
        if (failWrite) { failWrite = false; throw new Error('temporary save failure'); }
        const body = JSON.parse(options.body as string);
        if (body.revision !== remote.revision) return Response.json({ error: 'conflict' }, { status: 409 });
        remote = { revision: remote.revision + 1, settings: body.settings };
        return Response.json({ revision: remote.revision });
      }
      throw new Error('Unexpected fixture request');
    }));
    const { createPinia, setActivePinia, disposePinia } = await import('pinia');
    const pinia = createPinia();
    setActivePinia(pinia);
    client = await import('../src/renderer/services/nasClient');
    const { useSettingsStore } = await import('../src/renderer/store/modules/settings');
    store = useSettingsStore();
    stop = () => {};
    dispose = () => disposePinia(pinia);
  });

  afterEach(() => {
    stop?.();
    dispose?.();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const settle = () => vi.advanceTimersByTimeAsync(0);
  const start = async () => { stop = client.startNasAutoSync(); await settle(); };

  it('retries an initial read failure without a reload, and does not download unchanged scripts', async () => {
    failRead = true;
    await start();
    expect(client.nasSourcesReady.value).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.nasSourcesReady.value).toBe(true);
    expect(store.setData.lxMusicScripts[0].id).toBe('fixture-A');
    const count = reads;
    await vi.advanceTimersByTimeAsync(15000);
    expect(reads).toBe(count);
    expect(writes).toBe(0);
  });

  it('reads changes when the phone returns to foreground and pauses periodic checks while hidden', async () => {
    await start();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    const calls = vi.mocked(fetch).mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
    remote.revision++;
    remote.settings.lxMusicScripts.push({ id: 'fixture-B', script: 'synthetic' });
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    win.dispatchEvent(new Event('pageshow'));
    win.dispatchEvent(new Event('focus'));
    win.dispatchEvent(new Event('online'));
    await settle();
    expect(store.setData.lxMusicScripts).toHaveLength(2);
    expect(reads).toBe(2);
    expect(writes).toBe(0);
  });

  it('keeps local edits made during a save, and a foreground event cannot replace them', async () => {
    await start();
    let release!: () => void;
    holdWrite = new Promise(resolve => { release = resolve; });
    store.setSetData({ musicQuality: 'hires' });
    await vi.advanceTimersByTimeAsync(400);
    expect(client.nasSourcesSaving.value).toBe(true);
    store.setSetData({ lxAutoSwitch: false });
    win.dispatchEvent(new Event('focus'));
    await settle();
    expect(reads).toBe(1);
    release();
    holdWrite = undefined;
    await settle();
    await vi.advanceTimersByTimeAsync(400);
    expect(remote.settings.musicQuality).toBe('hires');
    expect(remote.settings.lxAutoSwitch).toBe(false);
    expect(client.nasSourcesDirty.value).toBe(false);
    store.setSetData({ autoPlay: !store.setData.autoPlay });
    await vi.advanceTimersByTimeAsync(500);
    expect(writes).toBe(2);
  });

  it('retains a failed local save and retries it automatically', async () => {
    await start();
    failWrite = true;
    store.setSetData({ musicQuality: 'hires' });
    await vi.advanceTimersByTimeAsync(400);
    expect(client.nasSourcesDirty.value).toBe(true);
    expect(store.setData.musicQuality).toBe('hires');
    await vi.advanceTimersByTimeAsync(5000);
    expect(remote.settings.musicQuality).toBe('hires');
    expect(client.nasSourcesDirty.value).toBe(false);
  });

  it('does not overwrite a newer configuration saved by another device', async () => {
    await start();
    remote.revision++;
    remote.settings.musicQuality = 'higher';
    store.setSetData({ musicQuality: 'hires' });
    await vi.advanceTimersByTimeAsync(400);
    expect(remote.settings.musicQuality).toBe('higher');
    expect(store.setData.musicQuality).toBe('higher');
    expect(client.nasSourcesReady.value).toBe(true);
  });
});
