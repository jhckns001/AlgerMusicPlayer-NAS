import { nasRequest } from './nasClient';

export const searchPlatforms = [
  { key: 'netease', label: '网易云音乐' }, { key: 'qq', label: 'QQ音乐' },
  { key: 'kugou', label: '酷狗音乐' }
];
export const catalogCategories = [
  { key: 1, label: '歌曲' }, { key: 10, label: '专辑' },
  { key: 1000, label: '歌单' }, { key: 100, label: '歌手' }
];
export function catalogLocation(id: string | number, kind: string) {
  const match = /^(qq|kugou):(.+)$/.exec(String(id));
  return match ? { name: 'catalogDetail', params: { platform: match[1], kind, id: match[2] } } : null;
}
export const catalogDetail = (params: Record<string, string>, signal?: AbortSignal) =>
  nasRequest<any>(`catalog/detail?${new URLSearchParams(params)}`, undefined, 'GET', signal);
