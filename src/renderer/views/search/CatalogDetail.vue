<template>
  <div class="h-full min-w-0 bg-white dark:bg-black">
    <n-scrollbar class="h-full">
      <main class="page-padding-x py-6 pb-36">
        <button class="mb-6 text-neutral-500 py-2" @click="router.back()">← 返回搜索</button>
        <header v-if="entity" class="flex gap-5 md:gap-8 items-end mb-8 min-w-0">
          <img v-if="entity.picUrl" :src="entity.picUrl" alt="" class="w-28 h-28 md:w-48 md:h-48 rounded-2xl object-cover shrink-0" />
          <div class="min-w-0">
            <p class="text-primary font-semibold mb-2">{{ entity.platformName }} · {{ kindLabel }}</p>
            <h1 class="text-2xl md:text-4xl font-bold break-words">{{ entity.name }}</h1>
            <p class="mt-3 text-neutral-500">{{ entity.desc === '歌手' ? '' : entity.desc }}</p>
          </div>
        </header>
        <p v-if="entity?.description" class="text-neutral-500 mb-6 whitespace-pre-line line-clamp-4">{{ entity.description }}</p>
        <button v-if="songs.length" class="px-6 py-3 rounded-full bg-primary text-white font-semibold mb-5" @click="playAll">播放全部</button>
        <div v-if="error" class="rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-5 mb-5" role="alert">
          <p>{{ error }}</p><button class="text-primary mt-3" @click="load(Boolean(songs.length))">重试</button>
        </div>
        <n-spin :show="loading">
          <song-item v-for="(song,index) in songs" :key="song.id" :item="song" :index="index" :favorite="false" :is-next="true" @play="play" />
          <p v-if="!loading && !error && !songs.length" class="text-center text-neutral-500 py-16">暂时没有可显示的歌曲</p>
        </n-spin>
        <button v-if="hasMore && !loading && !error" class="block mx-auto px-6 py-4 text-primary" @click="load(true)">加载更多</button>
      </main>
    </n-scrollbar>
    <play-bottom />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import SongItem from '@/components/common/SongItem.vue';
import PlayBottom from '@/components/common/PlayBottom.vue';
import { catalogDetail } from '@/services/musicCatalog';
import { usePlayerStore } from '@/store/modules/player';
import type { SongResult } from '@/types/music';

const route = useRoute(), router = useRouter(), player = usePlayerStore();
const entity = ref<any>(), songs = ref<SongResult[]>([]), loading = ref(false), error = ref('');
const hasMore = ref(false), offset = ref(0);
const kindLabel = computed(() => ({ album: '专辑', digital_album: '专辑', playlist: '歌单', artist: '歌手' }[String(route.params.kind)] || '音乐'));
let controller: AbortController | undefined, generation = 0;
async function load(more = false) {
  if (more && loading.value) return;
  if (!more) { generation++; controller?.abort(); songs.value = []; entity.value = undefined; offset.value = 0; }
  const current = generation;
  controller = new AbortController(); loading.value = true; error.value = '';
  try {
    const result = await catalogDetail({ platform: String(route.params.platform), kind: String(route.params.kind),
      id: String(route.params.id), offset: String(offset.value) }, controller.signal);
    if (current !== generation) return;
    entity.value = result.entity;
    songs.value = [...new Map([...songs.value, ...result.songs].map(s => [s.id, s])).values()] as SongResult[];
    const next = Number(result.nextOffset);
    hasMore.value = result.hasMore && (next > offset.value || result.songs.length > 0);
    offset.value = next > offset.value ? next : offset.value + 30;
  } catch (e) { if (current === generation && !controller.signal.aborted) error.value = e instanceof Error ? e.message : '加载失败，请重试'; }
  finally { if (current === generation) loading.value = false; }
}
const play = (song: SongResult) => player.prepareSongPlayback(song, songs.value);
const playAll = () => { if (songs.value[0]) { player.setPlayList(songs.value); player.setPlay(songs.value[0]); } };
watch(() => route.fullPath, () => { if (route.name === 'catalogDetail') load(); }, { immediate: true });
onBeforeUnmount(() => { generation++; controller?.abort(); });
</script>
