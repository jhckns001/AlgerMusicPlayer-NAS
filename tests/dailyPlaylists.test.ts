import { createRenderer, nextTick, reactive, ssrContextKey } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ route: undefined as any, user: undefined as any,
  daily: vi.fn(), category: vi.fn(), categories: vi.fn() }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('vue-router', () => ({ useRoute: () => mocks.route, useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/api/home', () => ({ getDailyRecommendPlaylists: mocks.daily, getPlaylistCategory: mocks.categories }));
vi.mock('@/api/list', () => ({ getListByCat: mocks.category }));
vi.mock('@/store/modules/user', () => ({ useUserStore: () => mocks.user }));
vi.mock('@/components/common/MusicListNavigator', () => ({ navigateToMusicList: vi.fn() }));
vi.mock('@/components/common/StickyTabPage.vue', () => ({ default: { render: () => null } }));
vi.mock('@/utils', () => ({ calculateAnimationDelay: () => 0, formatNumber: String, getImgUrl: (url: string) => url }));
import List from '@/views/list/index.vue';

const settle = async () => { for (let i = 0; i < 12; i++) await nextTick(); };
const dailyResult = (id: number) => ({ data: { code: 200, recommend: [{ id, name: 'fixture' }] } });

describe('daily playlist page uses account recommendations rather than the public top list', () => {
  let page: any, unmount: () => void, doc: EventTarget & { visibilityState: string }, win: EventTarget;
  let token: string | null;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-26T15:59:30Z'));
    token = 'synthetic-fixture-cookie';
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'token' ? token : null });
    doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    win = new EventTarget();
    vi.stubGlobal('document', doc); vi.stubGlobal('window', win);
    mocks.route = reactive({ path: '/list', query: {} as Record<string, string> });
    mocks.user = reactive({ user: { userId: 1 }, loginType: 'qr' });
    mocks.daily.mockReset().mockResolvedValue(dailyResult(101));
    mocks.category.mockReset().mockResolvedValue({ data: { playlists: [{ id: 201 }], more: false } });
    mocks.categories.mockReset().mockResolvedValue({ data: { sub: [{ name: '流行' }, { name: '摇滚' }] } });
    unmount = () => {};
  });
  afterEach(() => { unmount(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  const mount = async () => {
    const renderer = createRenderer<any, any>({ insert: () => {}, remove: () => {}, createElement: () => ({}),
      createText: () => ({}), createComment: () => ({}), setText: () => {}, setElementText: () => {},
      parentNode: () => null, nextSibling: () => null, patchProp: () => {} });
    const app = renderer.createApp({ ...List, render: () => null });
    app.provide(ssrContextKey, { modules: new Set() });
    page = (app.mount({}) as any).$.setupState;
    unmount = () => app.unmount();
    await settle();
  };

  it('calls the personal daily API and never paginates it as a top list', async () => {
    await mount();
    expect(mocks.daily).toHaveBeenCalledTimes(1);
    expect(mocks.category).not.toHaveBeenCalled();
    expect(page.recommendList.map((item: any) => item.id)).toEqual([101]);
    expect(page.hasMore).toBe(false);
    page.handleScroll({ target: { scrollTop: 100, scrollHeight: 100, clientHeight: 100 } });
    await settle();
    expect(mocks.daily).toHaveBeenCalledTimes(1);
  });

  it('shows a real login requirement instead of disguising popular playlists as daily recommendations', async () => {
    mocks.user.loginType = 'uid'; token = null;
    await mount();
    expect(mocks.daily).not.toHaveBeenCalled();
    expect(mocks.category).not.toHaveBeenCalled();
    expect(page.needsLogin).toBe(true);
    expect(page.loadError).toContain('扫码');
  });

  it('refreshes an open page after the Shanghai calendar day changes', async () => {
    await mount();
    mocks.daily.mockResolvedValue(dailyResult(102));
    await vi.advanceTimersByTimeAsync(60000);
    expect(mocks.daily).toHaveBeenCalledTimes(2);
    expect(page.recommendList[0].id).toBe(102);
  });

  it('pauses hidden-page checks and refreshes stale recommendations on return', async () => {
    await mount(); doc.visibilityState = 'hidden';
    await vi.advanceTimersByTimeAsync(16 * 60000);
    expect(mocks.daily).toHaveBeenCalledTimes(1);
    mocks.daily.mockResolvedValue(dailyResult(103));
    doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange'));
    win.dispatchEvent(new Event('focus'));
    await settle();
    expect(mocks.daily).toHaveBeenCalledTimes(2);
    expect(page.recommendList[0].id).toBe(103);
  });

  it('ignores a previous account response after the account changes', async () => {
    let finish!: (value: any) => void;
    mocks.daily.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue(dailyResult(202));
    await mount(); mocks.user.user = { userId: 2 }; await settle();
    finish(dailyResult(101)); await settle();
    expect(page.recommendList.map((item: any) => item.id)).toEqual([202]);
  });

  it('keeps category pagination, with deduplication and without the daily API', async () => {
    mocks.route.query = { type: '流行' };
    mocks.category.mockResolvedValueOnce({ data: { playlists: [{ id: 201 }], more: true } })
      .mockResolvedValueOnce({ data: { playlists: [{ id: 201 }, { id: 202 }], more: false } });
    await mount(); await page.loadList('流行', true);
    expect(mocks.category).toHaveBeenNthCalledWith(2, { cat: '流行', limit: 42, offset: 42 });
    expect(page.recommendList.map((item: any) => item.id)).toEqual([201, 202]);
    expect(mocks.daily).not.toHaveBeenCalled();
  });

  it('rejects an obsolete category response after switching back to daily recommendations', async () => {
    let finish!: (value: any) => void;
    await mount();
    mocks.category.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    mocks.route.query = { type: '流行' }; await settle();
    mocks.route.query = { type: '每日推荐' }; await settle();
    finish({ data: { playlists: [{ id: 999 }], more: true } }); await settle();
    expect(page.recommendList.map((item: any) => item.id)).toEqual([101]);
    expect(page.hasMore).toBe(false);
  });

  it('retries a failed daily request automatically without falling back to the top list', async () => {
    mocks.daily.mockRejectedValueOnce(new Error('fixture timeout'));
    const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
    await mount(); expect(page.loadError).toContain('失败');
    await vi.advanceTimersByTimeAsync(60000);
    expect(page.recommendList[0].id).toBe(101);
    expect(mocks.category).not.toHaveBeenCalled(); warning.mockRestore();
  });

  it('does not leave refresh timers running after the page is destroyed', async () => {
    await mount(); unmount(); unmount = () => {};
    await vi.advanceTimersByTimeAsync(60 * 60000);
    expect(mocks.daily).toHaveBeenCalledTimes(1);
  });
});
