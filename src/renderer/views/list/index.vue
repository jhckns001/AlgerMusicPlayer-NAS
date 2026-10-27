<template>
  <sticky-tab-page
    ref="pageRef"
    :title="listTitle"
    :description="currentType === DEFAULT_CAT ? '精选好歌单，发现更多音乐' : t('comp.pages.list.desc')"
    :model-value="currentType"
    :categories="playlistCategory?.sub || []"
    label-key="name"
    value-key="name"
    @change="handleTypeChange"
    @scroll="handleScroll"
  >
    <div v-if="loadError" role="alert" class="mb-6 rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-5 text-neutral-600 dark:text-neutral-300">
      <p>{{ loadError }}</p>
      <button class="mt-3 text-primary font-semibold" @click="loadList(currentType)">
        重试
      </button>
    </div>
    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
      <!-- Loading State -->
      <template v-if="loading && page === 0">
        <div v-for="i in 15" :key="`loading-${i}`" class="space-y-3">
          <div class="aspect-square skeleton-shimmer rounded-2xl" />
          <div class="h-4 w-3/4 skeleton-shimmer rounded-lg" />
        </div>
      </template>

      <!-- Content State -->
      <template v-else>
        <div
          v-for="(item, index) in recommendList"
          :key="item.id"
          class="list-card group cursor-pointer"
          :class="{ 'animate-item': !animatedIds.has(item.id) }"
          :style="{
            animationDelay: !animatedIds.has(item.id)
              ? calculateAnimationDelay(index % TOTAL_ITEMS, 0.05)
              : '0s'
          }"
          @click.stop="openPlaylist(item)"
          @animationend="animatedIds.add(item.id)"
        >
          <!-- Cover Image -->
          <div
            class="relative aspect-square overflow-hidden rounded-2xl shadow-md group-hover:shadow-xl transition-all duration-500"
          >
            <img
              :src="getImgUrl(item.picUrl || item.coverImgUrl, '400y400')"
              :alt="item.name"
              class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
              loading="lazy"
            />

            <!-- Play Overlay -->
            <div
              class="absolute inset-0 bg-transparent group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center"
            >
              <div
                class="play-icon w-12 h-12 rounded-full bg-white/90 flex items-center justify-center opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 transition-all duration-300 shadow-xl"
              >
                <i class="ri-play-fill text-2xl text-neutral-900 ml-1"></i>
              </div>
            </div>

            <!-- Play Count Badge -->
            <div
              class="absolute top-3 right-3 px-2 py-1 rounded-lg bg-black/40 backdrop-blur-md text-white text-[10px] font-bold flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
            >
              <i class="ri-play-fill"></i>
              {{ formatNumber(item.playCount) }}
            </div>
          </div>

          <!-- Info -->
          <div class="mt-3 space-y-1">
            <h3
              class="text-sm md:text-base font-bold text-neutral-900 dark:text-white line-clamp-1 group-hover:text-primary transition-colors"
            >
              {{ item.name }}
            </h3>
          </div>
        </div>
      </template>
    </div>

    <!-- 加载更多 -->
    <div v-if="isLoadingMore" class="flex justify-center items-center py-8">
      <n-spin size="small" />
      <span class="ml-2 text-neutral-500">{{ t('common.loading') }}</span>
    </div>
    <div v-if="!hasMore && recommendList.length > 0" class="text-center py-8 text-neutral-500">
      {{ t('common.noMore') }}
    </div>
  </sticky-tab-page>
</template>

<script lang="ts" setup>
import { nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import { getPlaylistCategory } from '@/api/home';
import { getListByCat, getPlaylistSquare } from '@/api/list';
import { navigateToMusicList } from '@/components/common/MusicListNavigator';
import StickyTabPage from '@/components/common/StickyTabPage.vue';
import type { IPlayListSort } from '@/types/playlist';
import { calculateAnimationDelay, formatNumber, getImgUrl } from '@/utils';

defineOptions({ name: 'List' });
const { t } = useI18n();
const TOTAL_ITEMS = 42;
const DEFAULT_CAT = '歌单广场';
const normalizeType = (value?: string) => !value || value === '每日推荐' ? DEFAULT_CAT : value;
const LIST_MAX_AGE = 15 * 60 * 1000;
const route = useRoute();
const router = useRouter();
const currentType = ref(normalizeType(route.query.type as string));
const listTitle = ref(currentType.value === DEFAULT_CAT ? DEFAULT_CAT : currentType.value);
const recommendList = ref<any[]>([]);
const page = ref(0);
const hasMore = ref(true);
const loading = ref(false);
const isLoadingMore = ref(false);
const loadError = ref('');
const squareCursor = ref(0);
const animatedIds = reactive(new Set<number>());
const pageRef = ref();
const playlistCategory = ref<IPlayListSort>();
let generation = 0;
let active = false;
let lastSquareKey = '';
let lastSquareFetch = 0;
let refreshTimer: ReturnType<typeof setInterval> | undefined;

const squareKey = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return `${parts.filter(part => part.type !== 'literal').map(part => part.value).join('-')}`;
};
const uniquePlaylists = (items: any[]) => [...new Map(items.map(item => [item.id, item])).values()];

const openPlaylist = (item: any) => navigateToMusicList(router, {
  id: item.id, type: 'playlist', name: item.name, listInfo: item, canRemove: false
});

const loadList = async (type: string, isLoadMore = false) => {
  type = normalizeType(type);
  if (isLoadMore && (!hasMore.value || loading.value || isLoadingMore.value)) return;
  const request = isLoadMore ? generation : ++generation;
  const key = squareKey();
  const current = () => request === generation && type === currentType.value;
  if (isLoadMore) isLoadingMore.value = true;
  else {
    loading.value = true;
    isLoadingMore.value = false;
    loadError.value = '';
    squareCursor.value = 0;
    page.value = 0;
    hasMore.value = true;
    recommendList.value = [];
    animatedIds.clear();
    await nextTick();
    if (!current()) return;
    pageRef.value?.scrollTo({ top: 0 });
  }
  try {
    if (type === DEFAULT_CAT) {
      const previousCursor = squareCursor.value;
      const { data } = await getPlaylistSquare({ cat: '全部', limit: TOTAL_ITEMS, before: isLoadMore ? previousCursor : 0 });
      if (!current()) return;
      if (data.code !== 200 || !Array.isArray(data.playlists)) throw new Error('Invalid playlist square response');
      recommendList.value = uniquePlaylists(isLoadMore ? [...recommendList.value, ...data.playlists] : data.playlists);
      const nextCursor = Number(data.lasttime || data.playlists.at(-1)?.updateTime || 0);
      hasMore.value = Boolean(data.more) && data.playlists.length > 0 && nextCursor > 0 &&
        (previousCursor === 0 || nextCursor < previousCursor);
      squareCursor.value = nextCursor;
      page.value++;
      lastSquareKey = key;
      lastSquareFetch = Date.now();
    } else {
      const { data } = await getListByCat({ cat: type, limit: TOTAL_ITEMS, offset: page.value * TOTAL_ITEMS });
      if (!current()) return;
      if (!Array.isArray(data.playlists)) throw new Error('Invalid category response');
      recommendList.value = uniquePlaylists(isLoadMore ? [...recommendList.value, ...data.playlists] : data.playlists);
      hasMore.value = Boolean(data.more);
      page.value++;
    }
  } catch (error) {
    if (current()) {
      loadError.value = '歌单加载失败，请重试。';
      console.error('加载歌单列表失败:', error);
    }
  } finally {
    if (current()) { loading.value = false; isLoadingMore.value = false; }
  }
};

const ensureFresh = () => {
  if (!active || route.path !== '/list' || document.visibilityState === 'hidden' || loading.value || isLoadingMore.value) return;
  if (currentType.value === DEFAULT_CAT) {
    if (lastSquareKey !== squareKey() || Date.now() - lastSquareFetch >= LIST_MAX_AGE) void loadList(DEFAULT_CAT);
  } else if (!recommendList.value.length && !loadError.value) void loadList(currentType.value);
};
const handleScroll = (event: any) => {
  if (loading.value || isLoadingMore.value || !hasMore.value) return;
  const { scrollTop, scrollHeight, clientHeight } = event.target;
  if (scrollTop + clientHeight >= scrollHeight - 100) void loadList(currentType.value, true);
};
const loadPlaylistCategory = async () => {
  const { data } = await getPlaylistCategory();
  playlistCategory.value = { ...data, sub: [{ name: DEFAULT_CAT, category: 0 }, ...data.sub] };
};
const handleTypeChange = (type: string) => router.replace({ query: { ...route.query, type } });

onMounted(() => {
  active = true;
  void loadPlaylistCategory().catch(error => console.error('加载歌单分类失败:', error));
  void loadList(currentType.value);
  refreshTimer = setInterval(ensureFresh, 60000);
  document.addEventListener('visibilitychange', ensureFresh);
  window.addEventListener('focus', ensureFresh);
});
onActivated(() => { active = true; ensureFresh(); });
onDeactivated(() => {
  active = false;
  generation++;
  loading.value = false;
  isLoadingMore.value = false;
  recommendList.value.forEach(item => animatedIds.add(item.id));
});
onBeforeUnmount(() => {
  active = false;
  generation++;
  if (refreshTimer) clearInterval(refreshTimer);
  document.removeEventListener('visibilitychange', ensureFresh);
  window.removeEventListener('focus', ensureFresh);
});

watch(() => route.query, params => {
  if (route.path !== '/list') return;
  const type = normalizeType(params.type as string);
  if (type !== currentType.value) {
    currentType.value = type;
    listTitle.value = type === DEFAULT_CAT ? DEFAULT_CAT : type;
    void loadList(type);
  }
});
</script>

<style lang="scss" scoped>
.animate-item {
  animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) backwards;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(24px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
