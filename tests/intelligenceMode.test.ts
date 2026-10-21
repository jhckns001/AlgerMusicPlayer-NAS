import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIntelligenceModeStore } from '@/store/modules/intelligenceMode';

const mocks = vi.hoisted(() => ({
  user: { user: { userId: 1 }, loginType: 'qr', playList: [{ id: 10, userId: 1, specialType: 5 }], initializePlaylist: vi.fn() },
  playlist: { playMode: 0, setPlayList: vi.fn() },
  getLikedList: vi.fn(), getIntelligenceList: vi.fn(), playTrack: vi.fn(), warning: vi.fn()
}));
vi.mock('naive-ui', () => ({ createDiscreteApi: () => ({ message: { warning: mocks.warning, error: vi.fn() } }) }));
vi.mock('@/../i18n/renderer', () => ({ default: { global: { t: (key: string) => key } } }));
vi.mock('@/api/music', () => ({ getLikedList: mocks.getLikedList, getIntelligenceList: mocks.getIntelligenceList }));
vi.mock('@/store/modules/user', () => ({ useUserStore: () => mocks.user }));
vi.mock('@/store/modules/playlist', () => ({ usePlaylistStore: () => mocks.playlist }));
vi.mock('@/services/playbackController', () => ({ playTrack: mocks.playTrack }));

describe('intelligence mode accepts an authenticated account, not UID-only access', () => {
  let values: Map<string, string>;
  beforeEach(() => {
    values = new Map([['token', 'synthetic-test-cookie']]);
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    setActivePinia(createPinia());
    mocks.user.loginType = 'qr';
    mocks.getLikedList.mockResolvedValue({ data: { ids: [11] } });
    mocks.getIntelligenceList.mockResolvedValue({ data: { data: [{ id: 11, songInfo: { id: 11, name: 'fixture', al: {} } }] } });
    mocks.playTrack.mockResolvedValue(true);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(['qr', 'cookie', 'token'])('accepts %s login with a saved credential', async type => {
    mocks.user.loginType = type;
    const store = useIntelligenceModeStore();
    await store.playIntelligenceMode();
    expect(mocks.getIntelligenceList).toHaveBeenCalledWith({ id: 11, pid: 10 });
    expect(store.isIntelligenceMode).toBe(true);
    expect(mocks.playlist.setPlayList).toHaveBeenCalledWith(expect.any(Array), false, true);
  });

  it('rejects UID login even when an old credential remains', async () => {
    mocks.user.loginType = 'uid';
    await useIntelligenceModeStore().playIntelligenceMode();
    expect(mocks.getLikedList).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalled();
  });

  it('rejects a QR login label without a credential', async () => {
    values.delete('token');
    await useIntelligenceModeStore().playIntelligenceMode();
    expect(mocks.getLikedList).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalled();
  });
});
