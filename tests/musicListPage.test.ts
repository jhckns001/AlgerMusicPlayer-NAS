import { createRenderer, nextTick, reactive, ref, ssrContextKey } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  route: undefined as any, music: undefined as any, player: undefined as any,
  getListDetail: vi.fn(), getAlbum: vi.fn(), getMusicDetail: vi.fn(),
  message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() }
}));
vi.mock('naive-ui', () => ({ useMessage: () => mocks.message }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('vue-router', () => ({ useRoute: () => mocks.route }));
vi.mock('pinyin-match', () => ({ default: { match: () => false } }));
vi.mock('@/api/list', () => ({ getAlbum: mocks.getAlbum, getListDetail: mocks.getListDetail }));
vi.mock('@/api/music', () => ({ getMusicDetail: mocks.getMusicDetail, subscribeAlbum: vi.fn(),
  subscribePlaylist: vi.fn(), updatePlaylistTracks: vi.fn() }));
vi.mock('@/components/common/SongItem.vue', () => ({ default: { render: () => null } }));
vi.mock('@/hooks/useDownload', () => ({ useDownload: () => ({ isDownloading: false, batchDownloadMusic: vi.fn() }) }));
vi.mock('@/hooks/useScrollTitle', () => ({ useScrollTitle: () => {} }));
vi.mock('@/store', () => ({ useMusicStore: () => mocks.music, usePlayerStore: () => mocks.player,
  useRecommendStore: () => ({ dailyRecommendSongs: [] }), useUserStore: () => ({ user: {}, isAlbumCollected: () => false }) }));
vi.mock('@/store/modules/playHistory', () => ({ usePlayHistoryStore: () => ({ addAlbum: vi.fn(), addPlaylist: vi.fn() }) }));
vi.mock('@/utils', () => ({ isMobile: ref(false), isElectron: false, getImgUrl: (url: string) => url,
  calculateAnimationDelay: () => 0 }));
vi.mock('@/utils/auth', () => ({ getLoginErrorMessage: () => '', hasPermission: () => true }));

import MusicListPage from '@/views/music/MusicListPage.vue';

const song = (id: number) => ({ id, name: 'fixture-' + id, ar: [], source: 'netease' });
const deferred = <T,>() => { let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 10; i++) await nextTick(); };

describe('playlist page keeps delayed loads within their original playlist', () => {
  let page: any;
  let unmount: () => void;
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
    mocks.route = reactive({ name: 'musicList', params: { id: '10' }, query: { type: 'playlist' }, fullPath: '/list/10' });
    mocks.music = reactive({ currentMusicList: [song(1)], currentMusicListName: 'A',
      currentListInfo: { id: 10, trackIds: [{ id: 1 }, { id: 2 }] }, canRemoveSong: false,
      setCurrentMusicList(songs: any[], name: string, info: any) {
        this.currentMusicList = songs; this.currentMusicListName = name; this.currentListInfo = info;
      } });
    mocks.player = reactive({ playList: [song(99)], playListIndex: 0, playMusic: song(99),
      playMusicUrl: '', dislikeList: [],
      setPlayList(songs: any[]) { this.playList = [...songs]; },
      setPlay(selected: any) { this.playMusic = selected; }, prepareSongPlayback: vi.fn() });
    mocks.getMusicDetail.mockReset();
    mocks.getListDetail.mockReset();
    mocks.getAlbum.mockReset();
    const renderer = createRenderer<any, any>({ insert: () => {}, remove: () => {}, createElement: () => ({}),
      createText: () => ({}), createComment: () => ({}), setText: () => {}, setElementText: () => {},
      parentNode: () => null, nextSibling: () => null, patchProp: () => {} });
    const app = renderer.createApp({ ...MusicListPage, render: () => null });
    app.provide(ssrContextKey, { modules: new Set() });
    const instance = app.mount({});
    page = (instance as any).$.setupState;
    unmount = () => app.unmount();
  });
  afterEach(() => { unmount?.(); vi.unstubAllGlobals(); });

  const switchList = async (id: number, first: number, last: number) => {
    mocks.music.setCurrentMusicList([song(first)], String(id), { id, trackIds: [{ id: first }, { id: last }] });
    mocks.route.params.id = String(id);
    mocks.route.fullPath = '/list/' + id;
    await settle();
  };

  it('ignores playlist A completing after playlist B has already replaced the queue', async () => {
    const old = deferred<any>(), current = deferred<any>();
    mocks.getMusicDetail.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    page.handlePlayAll();
    await switchList(20, 3, 4);
    page.handlePlayAll();
    current.resolve({ data: { songs: [song(4)] } });
    await settle();
    old.resolve({ data: { songs: [song(2)] } });
    await settle();
    expect(page.displayedSongs.map((s: any) => s.id)).toEqual([3, 4]);
    page.handlePlayAll();
    expect(mocks.player.playList.map((s: any) => s.id)).toEqual([3, 4]);
    expect(mocks.getMusicDetail).toHaveBeenCalledTimes(2);
  });

  it('does not let an old pagination response append to a newly selected playlist', async () => {
    const old = deferred<any>();
    mocks.getMusicDetail.mockReturnValueOnce(old.promise);
    const loading = page.loadMoreSongs();
    await switchList(20, 3, 4);
    old.resolve({ data: { songs: [song(2)] } });
    await loading;
    await settle();
    expect(page.displayedSongs.map((s: any) => s.id)).toEqual([3]);
  });

  it('replaces the old queue, orders songs by trackIds and excludes unexpected/duplicate API songs', async () => {
    mocks.music.setCurrentMusicList([song(1)], 'A', { id: 10, trackIds: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    await settle();
    mocks.getMusicDetail.mockResolvedValueOnce({ data: { songs: [song(3), song(99), song(2), song(2)] } });
    page.handlePlayAll();
    await settle();
    expect(mocks.player.playList.map((s: any) => s.id)).toEqual([1, 2, 3]);
  });

  it('uses fresh membership when reloading the same playlist id with changed tracks', async () => {
    mocks.music.setCurrentMusicList([song(5), song(6)], 'updated A', { id: 10, trackIds: [{ id: 5 }, { id: 6 }] });
    await settle();
    page.handlePlayAll(); await settle();
    expect(mocks.player.playList.map((s: any) => s.id)).toEqual([5, 6]);
  });

  it('playing an album twice keeps its complete list instead of selecting an empty completed list', async () => {
    mocks.music.setCurrentMusicList([song(5), song(6)], 'album', { id: 30 });
    mocks.route.params.id = '30'; mocks.route.query.type = 'album'; mocks.route.fullPath = '/list/30?type=album';
    await settle();
    page.handlePlayAll(); await settle();
    page.handlePlayAll(); await settle();
    expect(mocks.player.playList.map((s: any) => s.id)).toEqual([5, 6]);
  });

  it('ignores an old playlist detail response arriving after navigation to a newer one', async () => {
    const old = deferred<any>(), current = deferred<any>();
    mocks.getListDetail.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    mocks.music.currentMusicList = null;
    const oldRequest = page.fetchData();
    mocks.route.params.id = '20'; mocks.route.fullPath = '/list/20';
    current.resolve({ data: { code: 200, playlist: { id: 20, tracks: [song(3)], trackIds: [{ id: 3 }] } } });
    await settle();
    old.resolve({ data: { code: 200, playlist: { id: 10, tracks: [song(1)], trackIds: [{ id: 1 }] } } });
    await oldRequest;
    await settle();
    expect(mocks.music.currentListInfo.id).toBe(20);
    expect(page.displayedSongs.map((s: any) => s.id)).toEqual([3]);
    page.handlePlayAll();
    expect(mocks.player.playList.map((s: any) => s.id)).toEqual([3]);
  });

  it('does not let an old request mark a newer full-playlist request as completed', async () => {
    const old = deferred<any>(), current = deferred<any>();
    mocks.getMusicDetail.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    page.handlePlayAll();
    await switchList(20, 3, 4);
    page.handlePlayAll();
    old.resolve({ data: { songs: [song(2)] } });
    await settle();
    expect(page.isPlaylistLoading).toBe(true);
    expect(page.isFullPlaylistLoaded).toBe(false);
    page.handlePlayAll();
    expect(mocks.getMusicDetail).toHaveBeenCalledTimes(2);
    current.resolve({ data: { songs: [song(4)] } });
    await settle();
    expect(mocks.player.playList.map((s: any) => s.id)).toEqual([3, 4]);
  });

  it('ignores pending playlist batches after leaving the page', async () => {
    const old = deferred<any>();
    mocks.getMusicDetail.mockReturnValueOnce(old.promise);
    page.handlePlayAll();
    unmount(); unmount = () => {};
    old.resolve({ data: { songs: [song(2)] } });
    await settle();
    expect(page.displayedSongs).toEqual([]);
    expect(mocks.player.playList.map((s: any) => s.id)).toEqual([1]);
  });
});
