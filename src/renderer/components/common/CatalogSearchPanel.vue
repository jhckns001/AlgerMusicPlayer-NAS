<template>
  <section class="catalog-search-panel mb-8 space-y-4" aria-label="多平台音乐搜索">
    <form v-if="showInput" class="flex gap-3" @submit.prevent="submit">
      <input v-model="keyword" type="search" placeholder="搜索歌曲、歌手、专辑、歌单"
        aria-label="搜索关键词" class="min-w-0 flex-1 rounded-full px-5 py-3 bg-neutral-100 dark:bg-neutral-900 outline-none focus:ring-2 focus:ring-primary" />
      <button type="submit" class="rounded-full bg-primary text-white px-6 py-3 font-semibold">搜索</button>
    </form>
    <div class="flex flex-wrap gap-2" aria-label="音乐平台">
      <button v-for="platform in searchPlatforms" :key="platform.key" type="button"
        :aria-pressed="store.searchPlatform === platform.key" class="px-4 py-2.5 rounded-full text-sm transition-colors"
        :class="store.searchPlatform === platform.key ? 'bg-primary text-white' : 'bg-neutral-100 dark:bg-neutral-900 text-neutral-500'"
        @click="store.searchPlatform = platform.key">{{ platform.label }}</button>
    </div>
    <div class="flex flex-wrap gap-2" aria-label="搜索类别">
      <button v-for="category in catalogCategories" :key="category.key" type="button"
        :aria-pressed="store.searchType === category.key" class="px-4 py-2.5 rounded-full text-sm transition-colors"
        :class="store.searchType === category.key ? 'bg-primary text-white' : 'bg-neutral-100 dark:bg-neutral-900 text-neutral-500'"
        @click="store.searchType = category.key">{{ category.label }}</button>
    </div>
  </section>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { searchPlatforms, catalogCategories } from '@/services/musicCatalog';
import { useSearchStore } from '@/store/modules/search';
withDefaults(defineProps<{ showInput?: boolean }>(), { showInput: true });
const store = useSearchStore(), router = useRouter();
const keyword = ref(store.searchValue || '');
function submit() {
  const value = keyword.value.trim();
  if (!value) return;
  store.searchValue = value;
  router.push({ path: '/search-result', query: { keyword: value, type: store.searchType, platform: store.searchPlatform } });
}
</script>
