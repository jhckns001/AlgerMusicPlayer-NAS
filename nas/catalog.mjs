import { proxyCoverUrl } from './covers.mjs';
export const catalogPlatforms = ['qq', 'kugou'];
const sourceKeys = { qq: 'tx', kugou: 'kg' };
const labels = { qq: 'QQ音乐', kugou: '酷狗音乐' };
const kindMap = { '1': 'track', '10': 'album', '1000': 'playlist', '100': 'artist' };
const clean = value => String(value || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/[<>]/g, char => char === '<' ? '＜' : '＞');
const picture = value => {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? proxyCoverUrl(url.href) : ''; }
  catch { return ''; }
};
const nativeId = reference => String(reference || '').slice(String(reference || '').indexOf(':') + 1);
const validPlatform = platform => {
  if (!catalogPlatforms.includes(platform)) throw Object.assign(new Error('不支持这个音乐平台'), { status: 400 });
  return platform;
};
const reference = (platform, id) => `${validPlatform(platform)}:${String(id)}`;
const simpleArtist = (a, platform) => ({ id: a.ref || reference(platform, a.id || '0'), name: clean(a.name) });

export function normalizeCatalogTrack(track, platform) {
  validPlatform(platform);
  if (!track?.id || (track.platform && track.platform !== platform)) throw new Error('搜索结果的平台标识不一致');
  const ext = track.extensions || {};
  const albumId = nativeId(track.album?.ref || '');
  const cover = picture(track.album?.cover_url || ext.cover_url || ext.image_url ||
    (platform === 'qq' && /^[A-Za-z0-9]{14}$/.test(albumId)
      ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumId}.jpg` : '')) || '/music-placeholder.svg';
  const duration = Math.max(0, Number(track.duration_ms) || 0);
  const native = String(track.id);
  const songmid = platform === 'kugou' ? String(ext.hash || native).toLowerCase() : native;
  const qualityMap = { standard: '128k', high: '320k', higher: '320k', lossless: 'flac', hires: 'flac24bit' };
  const types = {}, available = new Set();
  for (const quality of track.available_qualities || []) if (qualityMap[quality]) available.add(qualityMap[quality]);
  for (const [quality, item] of Object.entries(ext.qualities || {})) {
    const type = qualityMap[quality];
    if (type && item && typeof item === 'object') { types[type] = { type, hash: item.hash,
      size: Number(item.size) || 0 }; available.add(type); }
  }
  const musicInfo = { songmid, source: sourceKeys[platform], name: clean(track.name),
    singer: (track.artists || []).map(a => clean(a.name)).join('、'), album: clean(track.album?.name),
    albumName: clean(track.album?.name), albumId, interval: `${Math.floor(duration / 60000)}:${String(Math.floor(duration / 1000) % 60).padStart(2, '0')}`,
    img: cover, types: [...available].map(type => ({ type, ...(types[type] || {}) })), _types: types };
  if (platform === 'qq') Object.assign(musicInfo, { songId: Number(ext.numeric_id) || native,
    strMediaMid: String(ext.media_mid || native) });
  if (platform === 'kugou') Object.assign(musicInfo, { hash: songmid, albumId,
    album_id: albumId, audioId: ext.audio_id, albumAudioId: ext.album_audio_id });
  return { id: reference(platform, native), platformId: native, source: platform,
    platformName: labels[platform], name: clean(track.name), picUrl: cover,
    ar: (track.artists || []).map(a => simpleArtist(a, platform)),
    al: { id: track.album?.ref || reference(platform, albumId || '0'), name: clean(track.album?.name), picUrl: cover },
    dt: duration, count: 0, lxMusicInfo: musicInfo };
}

function normalizeEntity(entity, kind, platform) {
  const id = String(entity.id || nativeId(entity.ref));
  const artists = (entity.artists || []).map(a => clean(a.name)).join(' / ');
  return { id: reference(platform, id), platformId: id, source: platform,
    platformName: labels[platform], name: clean(entity.name),
    picUrl: picture(entity.cover_url || entity.avatar_url), coverImgUrl: picture(entity.cover_url),
    description: clean(entity.description), desc: kind === 'artist' ? '歌手' : artists || clean(entity.creator?.name),
    creator: { nickname: clean(entity.creator?.name) }, artist: { name: artists },
    size: entity.track_count, albumSize: entity.album_count, musicSize: entity.track_count,
    playCount: entity.play_count, catalogKind: kind, type: kind === 'album' || kind === 'digital_album' ? '专辑' : kind };
}

export function createCatalogService({ base = process.env.MUSIC_CATALOG_URL || 'http://127.0.0.1:17832', request = fetch,
  retryDelayMs = 400, attemptTimeoutMs = 8000 } = {}) {
  const endpoint = new URL(base);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) throw new Error('搜索服务必须使用本机接口');
  const cache = new Map(), pending = new Map();
  const issues = [];
  const recordIssue = issue => {
    issues.push({ time: new Date().toISOString(), ...issue });
    if (issues.length > 40) issues.shift();
  };
  async function call(route, params = {}) {
    const url = new URL(route, endpoint);
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    const platform = params.platform || /\/(qq|kugou):/.exec(decodeURIComponent(route))?.[1] || 'unknown';
    const operation = route === '/v1/search' ? 'search' : route.endsWith('/tracks') ? 'tracks' : route.endsWith('/lyrics') ? 'lyrics' : 'detail';
    for (let attempt = 1; attempt <= 2; attempt++) {
      let response, result, problem;
      try {
        response = await request(url, { signal: AbortSignal.timeout(attemptTimeoutMs) });
        result = await response.json();
      } catch (error) {
        problem = { code: error?.name === 'TimeoutError' ? 'timeout' : response ? 'invalid_response' : 'network_error',
          status: response?.status || 503, retryable: true };
      }
      if (!problem && (!response.ok || result.ok === false)) {
        problem = { code: String(result.error?.code || `HTTP_${response.status}`).replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80),
          status: response.status, retryable: result.error?.retryable === true || response.status === 429 || response.status >= 500 };
      }
      if (!problem) {
        if (attempt > 1) recordIssue({ platform, operation, attempt, code: 'recovered', httpStatus: response.status });
        return result;
      }
      recordIssue({ platform, operation, attempt, code: problem.code, httpStatus: problem.status, retryable: problem.retryable });
      if (problem.retryable && attempt === 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        continue;
      }
      const status = problem.status === 422 ? 422 : problem.status === 429 ? 429 : problem.retryable ? 502 : 400;
      const message = status === 422 ? '这个平台暂不支持此类别' :
        `${labels[platform] || '平台'}接口暂时无法返回结果${attempt > 1 ? '，已自动重试一次' : ''}，请稍后重试（${problem.code}）`;
      throw Object.assign(new Error(message), { status });
    }
  }
  async function cached(key, operation) {
    if (cache.get(key)?.expires > Date.now()) return cache.get(key).value;
    if (pending.has(key)) return pending.get(key);
    const promise = operation().then(value => { if (cache.size >= 80) cache.delete(cache.keys().next().value);
      cache.set(key, { expires: Date.now() + 120000, value }); return value; }).finally(() => pending.delete(key));
    pending.set(key, promise); return promise;
  }
  return {
    diagnostics: () => issues.map(issue => ({ ...issue })),
    search: async ({ platform, type, keyword, offset = 0, limit = 30 }) => {
      validPlatform(platform);
      const kind = kindMap[String(type)], query = String(keyword || '').trim().slice(0, 100);
      if (!kind || !query) throw Object.assign(new Error('搜索类别或关键词不正确'), { status: 400 });
      const start = Math.min(3000, Math.max(0, Number(offset) || 0)), count = Math.min(50, Math.max(1, Number(limit) || 30));
      return cached(JSON.stringify([platform, kind, query, start, count]), async () => {
        const result = await call('/v1/search', { platform, type: kind, q: query, offset: start, limit: count });
        const items = (Array.isArray(result.data) ? result.data : result.data?.items || []).filter(item =>
          item.type === kind || (kind === 'album' && item.type === 'digital_album'));
        const values = items.map(item => kind === 'track' ? normalizeCatalogTrack(item.data, platform) : normalizeEntity(item.data, item.type, platform));
        const pagination = result.meta?.pagination || {};
        const key = { track: 'songs', album: 'albums', artist: 'artists', playlist: 'playlists' }[kind];
        return { code: 200, result: { [key]: values, hasMore: pagination.has_more === true,
          nextOffset: pagination.next_offset, total: pagination.total, platform } };
      });
    },
    detail: async ({ platform, kind, id, offset = 0 }) => {
      validPlatform(platform);
      if (!['album', 'playlist', 'artist', 'digital_album'].includes(kind) || !id || String(id).length > 300 || /[\r\n]/.test(id))
        throw Object.assign(new Error('详情参数不正确'), { status: 400 });
      const ref = reference(platform, id), segment = { album: 'albums', playlist: 'playlists', artist: 'artists', digital_album: 'digital-albums' }[kind];
      const route = `/v1/${segment}/${encodeURIComponent(ref)}`;
      return cached(JSON.stringify([platform, kind, id, offset]), async () => {
        const [meta, rows] = await Promise.all([call(route), call(route + '/tracks', { limit: 30,
          offset: Math.max(0, Number(offset) || 0) })]);
        return { entity: normalizeEntity(meta.data, kind, platform),
          songs: (Array.isArray(rows.data) ? rows.data : rows.data?.items || []).map(row => normalizeCatalogTrack(row.data || row, platform)),
          hasMore: rows.meta?.pagination?.has_more === true, nextOffset: rows.meta?.pagination?.next_offset };
      });
    },
    lyric: async ({ platform, id }) => {
      validPlatform(platform);
      if (!id || String(id).length > 300) throw Object.assign(new Error('歌曲 ID 不正确'), { status: 400 });
      const result = await call(`/v1/tracks/${encodeURIComponent(reference(platform, id))}/lyrics`);
      return { lrc: { lyric: String(result.data?.plain || '').slice(0, 200000) },
        tlyric: { lyric: String(result.data?.translated || '').slice(0, 200000) } };
    }
  };
}
