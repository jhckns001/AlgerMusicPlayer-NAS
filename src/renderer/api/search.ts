import { isElectron } from '@/utils';
import request from '@/utils/request';
import { isNasMode, nasRequest } from '@/services/nasClient';

interface IParams {
  keywords: string;
  type: number;
  limit?: number;
  offset?: number;
  platform?: string;
}
// 搜索内容
export const getSearch = async (params: IParams, signal?: AbortSignal) => {
  if (isNasMode && params.platform && params.platform !== 'netease') {
    const query = new URLSearchParams({ platform: params.platform, type: String(params.type),
      keyword: params.keywords, limit: String(params.limit || 30), offset: String(params.offset || 0) });
    return { data: await nasRequest<any>(`catalog/search?${query}`, undefined, 'GET', signal) };
  }
  return request.get<any>('/cloudsearch', {
    params: { keywords: params.keywords, type: params.type, limit: params.limit, offset: params.offset }, signal
  });
};

/**
 * 搜索建议接口返回的数据结构
 */
interface Suggestion {
  keyword: string;
}

interface KugouSuggestionResponse {
  data: Suggestion[];
}

// 搜索建议返回的数据结构（部分字段）
interface NeteaseSuggestResult {
  result?: {
    songs?: Array<{ name: string }>;
    artists?: Array<{ name: string }>;
    albums?: Array<{ name: string }>;
  };
  code?: number;
}

/**
 * 获取搜索建议
 * @param keyword 搜索关键词
 */
export const getSearchSuggestions = async (keyword: string) => {
  console.log('[API] getSearchSuggestions: 开始执行');

  if (!keyword || !keyword.trim()) {
    return Promise.resolve([]);
  }

  console.log(`[API] getSearchSuggestions: 准备请求，关键词: "${keyword}"`);

  try {
    let responseData: KugouSuggestionResponse;
    if (isElectron) {
      console.log('[API] Running in Electron, using IPC proxy.');
      responseData = await window.api.getSearchSuggestions(keyword);
    } else {
      // 非 Electron 环境下，使用接口
      const res = await request.get<NeteaseSuggestResult>('/search/suggest', {
        params: { keywords: keyword }
      });

      const result = res?.data?.result || {};
      const names: string[] = [];
      if (Array.isArray(result.songs)) names.push(...result.songs.map((s) => s.name));
      if (Array.isArray(result.artists)) names.push(...result.artists.map((a) => a.name));
      if (Array.isArray(result.albums)) names.push(...result.albums.map((al) => al.name));

      // 去重并截取前10个
      const unique = Array.from(new Set(names)).slice(0, 10);
      console.log('[API] getSearchSuggestions: 解析成功:', unique);
      return unique;
    }

    if (responseData && Array.isArray(responseData.data)) {
      const suggestions = responseData.data.map((item) => item.keyword).slice(0, 10);
      console.log('[API] getSearchSuggestions: 成功解析建议:', suggestions);
      return suggestions;
    }

    console.warn('[API] getSearchSuggestions: 响应数据格式不正确，返回空数组。');
    return [];
  } catch (error) {
    console.error('[API] getSearchSuggestions: 请求失败，错误信息:', error);
    return [];
  }
};
