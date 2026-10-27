import { createRenderer, nextTick, reactive, ssrContextKey } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ route: undefined as any, user: undefined as any,
  square: vi.fn(), category: vi.fn(), categories: vi.fn() }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('vue-router', () => ({ useRoute: () => mocks.route, useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/api/home', () => ({ getPlaylistCategory: mocks.categories }));
vi.mock('@/api/list', () => ({ getListByCat: mocks.category, getPlaylistSquare: mocks.square }));
vi.mock('@/store/modules/user', () => ({ useUserStore: () => mocks.user }));
vi.mock('@/components/common/MusicListNavigator', () => ({ navigateToMusicList: vi.fn() }));
vi.mock('@/components/common/StickyTabPage.vue', () => ({ default: { render: () => null } }));
vi.mock('@/utils', () => ({ calculateAnimationDelay: () => 0, formatNumber: String, getImgUrl: (url: string) => url }));
import List from '@/views/list/index.vue';

const settle = async () => { for (let i = 0; i < 12; i++) await nextTick(); };
const squareResult = (id: number, lasttime = 1000, more = true) => ({ data: { code: 200, playlists: [{ id, name: 'fixture' }], lasttime, more } });

describe('playlist square browses curated playlists with cursor pagination', () => {
  let page: any, unmount: () => void, doc: EventTarget & { visibilityState: string }, win: EventTarget;
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T15:59:30Z'));
    vi.stubGlobal('localStorage', { getItem: () => null });
    doc = Object.assign(new EventTarget(), { visibilityState: 'visible' }); win = new EventTarget();
    vi.stubGlobal('document', doc); vi.stubGlobal('window', win);
    mocks.route = reactive({ path: '/list', query: {} as Record<string, string> });
    mocks.user = reactive({ user: null, loginType: 'uid' });
    mocks.square.mockReset().mockResolvedValue(squareResult(101));
    mocks.category.mockReset().mockResolvedValue({ data: { playlists: [{ id: 201 }], more: false } });
    mocks.categories.mockReset().mockResolvedValue({ data: { sub: [{ name: '流行' }, { name: '摇滚' }] } });
    unmount = () => {};
  });
  afterEach(() => { unmount(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  const mount = async () => {
    const renderer = createRenderer<any, any>({ insert: () => {}, remove: () => {}, createElement: () => ({}),
      createText: () => ({}), createComment: () => ({}), setText: () => {}, setElementText: () => {},
      parentNode: () => null, nextSibling: () => null, patchProp: () => {} });
    const app = renderer.createApp({ ...List, render: () => null }); app.provide(ssrContextKey, { modules: new Set() });
    page = (app.mount({}) as any).$.setupState; unmount = () => app.unmount(); await settle();
  };
  it('opens the square without requiring a personal login or calling the generic hot list', async () => {
    await mount(); expect(page.listTitle).toBe('歌单广场');
    expect(mocks.square).toHaveBeenCalledWith({ cat: '全部', limit: 42, before: 0 });
    expect(mocks.category).not.toHaveBeenCalled(); expect(page.loadError).toBe('');
    expect(page.recommendList.map((item: any) => item.id)).toEqual([101]);
  });
  it('maps old daily-recommendation links to the square', async () => {
    mocks.route.query = { type: '每日推荐' }; await mount();
    expect(page.currentType).toBe('歌单广场'); expect(mocks.square).toHaveBeenCalledTimes(1);
  });
  it('uses the API cursor and removes duplicate cards between pages', async () => {
    mocks.square.mockResolvedValueOnce(squareResult(101, 1000)).mockResolvedValueOnce({ data: {
      code: 200, playlists: [{ id: 101 }, { id: 102 }], lasttime: 900, more: false } });
    await mount(); await page.loadList('歌单广场', true);
    expect(mocks.square).toHaveBeenNthCalledWith(2, { cat: '全部', limit: 42, before: 1000 });
    expect(page.recommendList.map((item: any) => item.id)).toEqual([101, 102]); expect(page.hasMore).toBe(false);
  });
  it('stops pagination if the API cursor does not advance', async () => {
    await mount(); await page.loadList('歌单广场', true);
    expect(page.hasMore).toBe(false); await page.loadList('歌单广场', true);
    expect(mocks.square).toHaveBeenCalledTimes(2);
  });
  it('preserves category pagination using offsets', async () => {
    mocks.route.query = { type: '流行' };
    mocks.category.mockResolvedValueOnce({ data: { playlists: [{ id: 201 }], more: true } })
      .mockResolvedValueOnce({ data: { playlists: [{ id: 202 }], more: false } });
    await mount(); await page.loadList('流行', true);
    expect(mocks.category).toHaveBeenNthCalledWith(2, { cat: '流行', limit: 42, offset: 42 });
    expect(mocks.square).not.toHaveBeenCalled();
  });
  it('discards the old square response when a category is selected', async () => {
    let finish!: (value: any) => void; mocks.square.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await mount(); mocks.route.query = { type: '流行' }; await settle(); finish(squareResult(999)); await settle();
    expect(page.recommendList.map((item: any) => item.id)).toEqual([201]);
  });
  it('refreshes after a day change and does not read while hidden', async () => {
    await mount(); doc.visibilityState = 'hidden'; await vi.advanceTimersByTimeAsync(60000);
    expect(mocks.square).toHaveBeenCalledTimes(1); mocks.square.mockResolvedValue(squareResult(102));
    doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(page.recommendList[0].id).toBe(102);
  });
  it('shows a retry message on network failure without substituting homepage recommendations', async () => {
    mocks.square.mockRejectedValueOnce(new Error('fixture timeout')); const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
    await mount(); expect(page.loadError).toContain('失败'); await vi.advanceTimersByTimeAsync(60000);
    expect(page.recommendList[0].id).toBe(101); expect(mocks.category).not.toHaveBeenCalled(); warning.mockRestore();
  });
  it('removes refresh listeners and timers when destroyed', async () => {
    await mount(); unmount(); unmount = () => {}; await vi.advanceTimersByTimeAsync(60 * 60000);
    expect(mocks.square).toHaveBeenCalledTimes(1);
  });
});
