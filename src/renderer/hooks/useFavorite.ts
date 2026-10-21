import { computed } from 'vue';
import { createDiscreteApi } from 'naive-ui';

import { playMusic } from '@/hooks/MusicHook';
import { usePlayerStore } from '@/store/modules/player';

/**
 * 当前歌曲的收藏状态管理 composable
 */
export function useFavorite() {
  const playerStore = usePlayerStore();

  /** 当前歌曲是否已收藏 */
  const isFavorite = computed(() => {
    if (!playMusic?.value?.id) return false;
    return playerStore.favoriteList.includes(playMusic.value.id);
  });

  /** 切换收藏状态 */
  const toggleFavorite = (e?: Event) => {
    e?.stopPropagation();
    if (!playMusic?.value?.id) return;
    if (playMusic.value.source && playMusic.value.source !== 'netease') {
      createDiscreteApi(['message']).message.info('该平台歌曲暂不支持网易云收藏');
      return;
    }

    const favoriteId = playMusic.value.id;
    if (isFavorite.value) {
      playerStore.removeFromFavorite(favoriteId);
    } else {
      playerStore.addToFavorite(favoriteId);
    }
  };

  return {
    isFavorite,
    toggleFavorite
  };
}
