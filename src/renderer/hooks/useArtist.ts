import { useRouter } from 'vue-router';
import { catalogLocation } from '@/services/musicCatalog';
import { isNasMode } from '@/services/nasClient';

export const useArtist = () => {
  const router = useRouter();

  /**
   * 跳转到歌手详情页
   * @param id 歌手ID
   */
  const navigateToArtist = (id: number | string) => {
    router.push((isNasMode && catalogLocation(id, 'artist')) || `/artist/detail/${id}`);
  };

  return {
    navigateToArtist
  };
};
