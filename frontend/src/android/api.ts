import { qqHotSearch } from '../../../backend/src/modules/catalog/hot-search';
import { chartTracks, listCharts } from '../../../backend/src/modules/catalog/charts';
import { collectDiscoverTracks, discoverFilters, discoverPlaylists, discoverTracks, mobileKugouPlaylists, searchPlaylists } from '../../../backend/src/modules/catalog/discover';
import { albumPlatforms, albumTracks, searchAlbums, validAlbumId } from '../../../backend/src/modules/catalog/albums';
import { enrichOnlineTrack, getOnlineTrack, onlineTracks, publicOnlineTrack, saveOnlineTrack, searchCatalog } from '../../../backend/src/modules/catalog/service';
import { getOnlineLyrics } from '../../../backend/src/modules/lyrics/online';
import { SourceScheduler } from '../../../backend/src/modules/sources/scheduler';
import { prepareAudio, requireAndroidConnection } from './network';
import { changeAndroidFavorites, getAndroidFavorites } from './favorites';
import { editSource, importSource, listSources, requestSource, saveSourceSettings, sourceSettings, sources } from './sources';
import { read, write } from './storage';

const scheduler = new SourceScheduler();
const historyLimit = 200;
const qualities = ['flac24bit', 'flac', '320k', '128k'];
interface Playlist { id: string; name: string; trackIds: string[]; createdAt: string }

function readHistory() {
  const stored = read<unknown[]>('history', []);
  const history = [...new Set(stored.filter((id): id is string => typeof id === 'string' && id.length > 0))]
    .slice(0, historyLimit);
  if (history.length !== stored.length) {
    try { write('history', history); }
    catch { /* The list remains usable even if storage is unavailable. */ }
  }
  return history;
}

async function resolve(id: string, quality: string, exclude: string[], signal?: AbortSignal) {
  const track = getOnlineTrack(id);
  const position = qualities.indexOf(quality);
  if (position < 0) throw new Error('无效音质');
  await requireAndroidConnection(signal);
  const acceptedQualities = qualities.slice(position);
  const enabled = sources.filter(source => source.enabled);
  if (!enabled.length) throw new Error('没有已启用的音源，请在设置中导入或启用音源');
  const candidates = enabled.filter(source => {
    const capability = source.capabilities[track.platform];
    return !exclude.includes(source.id) && capability?.actions.includes('musicUrl')
      && capability.qualitys.some(item => acceptedQualities.includes(item));
  });
  if (!candidates.length) {
    throw new Error(exclude.length ? '可用音源的音频都未能播放，请稍后重试' : '已启用音源不支持这首歌的平台或所选音质');
  }
  let audioUrl = "";
  let gotLink = false;
  let unsupportedProtocol = false;
  let timedOut = false;
  const resolved = await scheduler.resolve(candidates.map(source => ({
    id: source.id, priority: source.priority, get enabled() { return source.enabled; },
    platforms: Object.keys(source.capabilities).filter(platform => source.capabilities[platform].actions.includes('musicUrl')),
    qualities: source.capabilities[track.platform]?.qualitys || [],
    async resolve(request, sourceSignal) {
      const result = await requestSource(source, { source: track.platform, action: 'musicUrl',
        info: { type: request.quality, musicInfo: track.musicInfo } }, sourceSignal);
      if (typeof result !== 'string') throw new Error('音源没有返回播放链接');
      return result;
    },
  })), { platform: track.platform, songId: track.songId }, {
    qualities: acceptedQualities, signal, cooldownMs: 0, perSourceTimeoutMs: 21000,
    onFailure: (_sourceId, _quality, reason) => { timedOut ||= reason === 'timeout'; },
    validate: async url => {
      const parsed = new URL(url);
      gotLink = true;
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        unsupportedProtocol = true;
        throw new Error('无效或不支持的音频地址');
      }
      try {
        audioUrl = await prepareAudio(url);
      } catch (error) {
        if ((error as Error)?.message === "该 HTTP 音频域名尚未开放") unsupportedProtocol = true;
        throw error;
      }
    },
  }).catch(async error => {
    await requireAndroidConnection(signal);
    if (error instanceof DOMException && error.name === 'TimeoutError') timedOut = true;
    if (gotLink) {
      throw new Error(unsupportedProtocol
        ? '音源返回的地址无效，或该 HTTP 音频域名尚未开放'
        : '已取得音频链接，但手机未能连接音频服务器，请稍后重试');
    }
    throw new Error(timedOut ? '音源取链超时，请检查手机网络或代理后重试' : '音源未能解析这首歌，请尝试其他歌曲或音质');
  });
  signal?.throwIfAborted();
  // A storage failure must not prevent playback of an already resolved stream.
  try { await saveOnlineTrack(track); } catch { /* Storage already logged the failure. */ }
  return { mode: 'online', sourceId: resolved.sourceId, quality: resolved.quality,
    sourceName: sources.find(source => source.id === resolved.sourceId)?.name || '在线音源',
    audioUrl, lyricUrl: '/online/' + encodeURIComponent(id) + '/lyrics' };
}

async function playlistRequest(method: string, id: string, action: string, trackId: string, body: Record<string, any>) {
  const playlists = read<Playlist[]>('playlists', []);
  if (method === 'POST' && id === 'import' && !action) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new Error('歌单名称不能为空');
    if (playlists.length >= 100) throw new Error('最多支持 100 个歌单');
    const ids = body.trackIds;
    if (!body.source && (!Array.isArray(ids) || ids.length > 10000 || ids.some(id => typeof id !== 'string')))
      throw new Error('请选择 1–10000 首歌曲');
    const tracks = body.source
      ? await collectDiscoverTracks(body.source.platform, body.source.id)
      : [...new Set<string>(ids)].map(getOnlineTrack);
    if (!tracks.length) throw new Error('歌单没有可导入的歌曲');
    for (const track of tracks) await saveOnlineTrack(track);
    const current = read<Playlist[]>('playlists', []);
    if (current.length >= 100) throw new Error('最多支持 100 个歌单');
    const entry = { id: crypto.randomUUID(), name, trackIds: tracks.map(track => track.id), createdAt: new Date().toISOString() };
    write('playlists', [...current, entry]);
    return entry;
  }
  if (!id) {
    if (method === 'GET') {
      return playlists.map(item => {
        const first = onlineTracks[item.trackIds[0]];
        return { ...item, count: item.trackIds.length, coverTrackId: first?.id, coverOnline: Boolean(first) };
      });
    }
    const name = String(body.name || '').trim();
    if (!name || name.length > 80) throw new Error('请输入 1–80 字的歌单名称');
    const entry = { id: crypto.randomUUID(), name, trackIds: [], createdAt: new Date().toISOString() };
    write('playlists', [...playlists, entry]);
    return entry;
  }
  const entry = playlists.find(item => item.id === id);
  if (!entry) throw new Error('歌单不存在');
  if (method === 'PATCH' && !action) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 80) throw new Error('歌单名称需要为 1–80 字');
    entry.name = name;
    write('playlists', playlists);
    return entry;
  }
  if (method === 'GET') {
    return { ...entry, tracks: entry.trackIds.flatMap(id => onlineTracks[id] ? [publicOnlineTrack(onlineTracks[id])] : []) };
  }
  if (method === 'DELETE' && !action) write('playlists', playlists.filter(item => item !== entry));
  else if (action === 'tracks') {
    if (method === 'DELETE' || trackId === 'remove-batch') {
      const excluded = new Set(trackId === 'remove-batch' ? body.trackIds : [trackId]);
      entry.trackIds = entry.trackIds.filter(id => !excluded.has(id));
    } else {
      const ids: string[] = Array.isArray(body.trackIds) ? body.trackIds : [body.trackId];
      for (const id of ids) getOnlineTrack(id);
      for (const id of ids) await saveOnlineTrack(getOnlineTrack(id));
      entry.trackIds = [...new Set([...entry.trackIds, ...ids])];
    }
    write('playlists', playlists);
  }
  return entry;
}

export async function requestAndroidApi(path: string, init: RequestInit) {
  const url = new URL(path, location.origin);
  const [resource = '', id = '', action = '', detail = ''] = url.pathname.split('/').slice(1).map(decodeURIComponent);
  const query = url.searchParams;
  const page = Number(query.get('page') || 1);
  const refresh = query.get('refresh') === '1';
  const method = (init.method || 'GET').toUpperCase();
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
  const signal = init.signal || new AbortController().signal;
  signal?.throwIfAborted();
  switch (resource) {
    case 'library':
      return { directories: [], tracks: [], onlineTracks: Object.values(onlineTracks).map(publicOnlineTrack),
        favorites: await getAndroidFavorites(), history: readHistory(),
        scan: { running: false, scanned: 0, failed: 0, errors: [] } };
    case 'charts':
      return action ? chartTracks(id, action, page, refresh) : { charts: await listCharts(id, refresh) };
    case 'discover':
      if (action === 'filters') {
        if (id === 'kg') {
          const sorts = [{ id: 'recommend', name: '推荐' }];
          return { sorts, categorySorts: sorts, groups: [] };
        }
        return discoverFilters(id, refresh);
      }
      if (action === 'search') return searchPlaylists(id, query.get('q') || '', page, refresh);
      if (action) return discoverTracks(id, action, page, refresh);
      if (id === 'kg') return mobileKugouPlaylists(page, refresh);
      return discoverPlaylists(id, page, refresh, query.get('sort') || undefined, query.get('category') || 'all');
    case 'catalog':
      if (id === 'hot-search') return { keywords: await qqHotSearch() };
      if (id === 'search') return searchCatalog(query.get('q') || '', query.get('platform') || 'all', page, signal, Number(query.get('pageSize') || 50), true);
      if (id === 'albums') {
        const platform = query.get('platform') || 'wy';
        if (!action) {
          if (platform !== 'all' && !albumPlatforms.has(platform)) throw new Error('不支持的专辑平台');
          return searchAlbums(query.get('q') || '', platform, page, signal);
        }
        const albumId = query.get('id') || '';
        if (!validAlbumId(action, albumId)) throw new Error('无效专辑');
        return { tracks: await albumTracks(action, albumId, signal, query.get('name') || '', query.get('artist') || '') };
      }
      if (id === 'track-album') {
        const track = getOnlineTrack(action);
        const albumId = String(track.musicInfo.albumMid || track.musicInfo.albumId || '');
        if (!validAlbumId(track.platform, albumId)) throw new Error('这首歌没有可用的专辑信息');
        return { name: track.album, tracks: await albumTracks(track.platform, albumId, signal, track.album, track.artist) };
      }
      break;
    case 'sources':
      if (!id) return listSources();
      if (id === 'import') return importSource(body.script, body.url, signal);
      if (id === 'activity') return [];
      if (id === 'settings') {
        if (method === 'PATCH') {
          if (!qualities.includes(body.quality)) throw new Error('无效音质');
          sourceSettings.quality = body.quality;
          saveSourceSettings();
        }
        return sourceSettings;
      }
      return editSource(id, method, body, action === 'check', signal);
    case 'online':
      if (action === 'resolve') return resolve(id, body.quality || sourceSettings.quality, body.exclude || [], signal);
      if (action === 'playback-failed') return {};
      if (action === 'lyrics') return { text: await getOnlineLyrics(getOnlineTrack(id), signal) };
      if (action === 'details') return publicOnlineTrack(await enrichOnlineTrack(getOnlineTrack(id), signal));
      break;
    case 'favorites': {
      if (id === 'remove-batch') return changeAndroidFavorites({ removeIds: body.trackIds });
      await saveOnlineTrack(getOnlineTrack(id));
      const favorites = await changeAndroidFavorites({ toggleId: id });
      return query.has('feedback') ? { favorites } : favorites;
    }
    case 'history': {
      let updated: string[] = [];
      if (method !== 'DELETE') {
        await saveOnlineTrack(getOnlineTrack(id));
        const current = readHistory();
        updated = [id, ...current.filter(item => item !== id)].slice(0, historyLimit);
      }
      write('history', updated);
      return updated;
    }
    case 'playlists':
      return playlistRequest(method, id, action, detail, body);
  }
  throw new Error('此功能在安卓端不可用');
}
