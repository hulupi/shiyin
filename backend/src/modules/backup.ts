import { Router, json } from 'express';
import { deleteScript, readScript, replaceRecords, writeScript, loadPlaylists, loadSetting, saveIds, savePlaylists, saveSetting, transaction, upsertRecord } from '../db/database.js';
import { state } from '../db/store.js';
import { onlineTracks, type OnlineTrack } from './catalog/service.js';
import { downloadPreferences, isFilenameFormat, isPlaybackDownloadPercent, reloadDownloadSettings } from './downloads/service.js';
import { reloadPlaylists } from './playlists/service.js';
import { listSourceActivity, reloadSourceActivity } from './sources/activity.js';
import { applyRestoredSources, maxSourceBytes, platforms, qualities, scriptInfo, sources, sourceSettings, type SourceEntry } from './sources/service.js';

const format = 'shiyin-backup';
const maxBytes = 32 * 1024 * 1024;
const booleanSettings = ['saveLyrics', 'embedMetadata', 'autoDownloadFavorites', 'autoDownloadPlayback'] as const;
type Playlist = Parameters<typeof savePlaylists>[0][number];

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function invalid(): never {
  throw new Error('备份文件格式不正确或版本不受支持');
}

function string(value: unknown): string {
  if (typeof value !== 'string') invalid();
  return value;
}

function list<T>(value: unknown, limit: number, read: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > limit) invalid();
  return value.map(read);
}

function ids(value: unknown) {
  return [...new Set(list(value, 100_000, item => {
    const id = string(item);
    if (!/^(?:[a-f0-9]{24}|online:(?:wy|tx|kw|kg|mg):[^\s]{1,240})$/.test(id)) invalid();
    return id;
  }))];
}

function readPlaylist(value: unknown): Playlist {
  const item = record(value);
  const name = string(item.name);
  const id = string(item.id);
  if (!/^[a-f0-9-]{36}$/.test(id) || !name.trim() || name.length > 80) invalid();
  return { id, name, createdAt: string(item.createdAt), trackIds: ids(item.trackIds) };
}

function readActivity(value: unknown) {
  const item = record(value);
  for (const key of ['id', 'operationId', 'operation', 'stage', 'time', 'trackId', 'title', 'artist', 'requestedQuality']) string(item[key]);
  for (const key of ['message', 'source', 'quality', 'format', 'fromSource', 'fromQuality', 'reason']) {
    if (item[key] !== undefined) string(item[key]);
  }
  if (item.bitrate !== undefined && typeof item.bitrate !== 'number') invalid();
  return item;
}

function readOnlineTrack(value: unknown): OnlineTrack {
  const item = record(value);
  const platform = string(item.platform);
  if (!platforms.some(candidate => candidate === platform) || item.id !== 'online:' + platform + ':' + string(item.songId)) invalid();
  for (const key of ['title', 'artist', 'album', 'format']) string(item[key]);
  for (const key of ['duration', 'size', 'modified']) {
    if (typeof item[key] !== 'number' || !Number.isFinite(item[key])) invalid();
  }
  for (const key of ['image', 'lyricUrl']) if (item[key] !== undefined) string(item[key]);
  const musicInfo = record(item.musicInfo);
  const readVariant = (input: unknown) => {
    const variant = record(input);
    string(variant.type);
    return variant;
  };
  if (musicInfo.types !== undefined) list(musicInfo.types, 100, readVariant);
  if (item.audioVariants !== undefined) list(item.audioVariants, 100, value => {
    const variant = record(value);
    string(variant.quality);
    string(variant.format);
    return variant;
  });
  if (item.qualities !== undefined) list(item.qualities, 100, string);
  return { ...item, online: true, directoryId: '', musicInfo } as unknown as OnlineTrack;
}

function readDownloadPreferences(value: unknown) {
  const item = record(value);
  const preferences: Record<string, string | boolean | number> = {};
  if (item.playbackDownloadPercent !== undefined) {
    if (!isPlaybackDownloadPercent(item.playbackDownloadPercent)) invalid();
    preferences.playbackDownloadPercent = item.playbackDownloadPercent;
  }
  if (item.quality !== undefined) {
    const quality = string(item.quality);
    if (!qualities.includes(quality)) invalid();
    preferences.quality = quality;
  }
  if (item.filenameFormat !== undefined) {
    if (!isFilenameFormat(item.filenameFormat)) invalid();
    preferences.filenameFormat = item.filenameFormat;
  }
  for (const key of booleanSettings) {
    const enabled = item[key];
    if (enabled === undefined) continue;
    if (typeof enabled !== 'boolean') invalid();
    preferences[key] = enabled;
  }
  return preferences;
}

function readSource(value: unknown) {
  const item = record(value);
  const id = string(item.id);
  const script = string(item.script);
  if (!/^[a-f0-9-]{36}$/.test(id) || !script.trim() || Buffer.byteLength(script) > maxSourceBytes) invalid();
  if (typeof item.enabled !== 'boolean' || typeof item.priority !== 'number' ||
      !Number.isSafeInteger(item.priority) || item.priority < 0) invalid();
  const capabilities: SourceEntry['capabilities'] = {};
  const supported = record(item.capabilities);
  for (const platform of [...platforms, 'local']) {
    if (supported[platform] === undefined) continue;
    const capability = record(supported[platform]);
    capabilities[platform] = {
      actions: list(capability.actions, 100, string),
      qualitys: list(capability.qualitys, 100, string),
    };
  }
  const info = scriptInfo(script);
  const entry: SourceEntry = {
    id, name: info.name, version: info.version, author: info.author,
    description: info.description, enabled: item.enabled, priority: item.priority,
    importedAt: string(item.importedAt), capabilities,
  };
  return { entry, script };
}

export const backupRouter = Router();
backupRouter.get('/backup', (_req, res) => {
  const playlists = loadPlaylists<Playlist>();
  const related = new Set([...state.favorites, ...state.history, ...playlists.flatMap(item => item.trackIds)]);
  const downloads = downloadPreferences();
  res.set('Cache-Control', 'no-store').json({
    format,
    version: 1,
    createdAt: new Date().toISOString(),
    data: {
      quality: sourceSettings.quality, downloads, favorites: state.favorites,
      history: state.history, playlists, activity: listSourceActivity(),
      sources: sources.map(entry => ({ ...entry, script: readScript(entry.id) })),
      onlineTracks: Object.values(onlineTracks).filter(track => related.has(track.id)),
    },
  });
});

backupRouter.post('/backup/restore', json({ limit: maxBytes, type: 'application/vnd.shiyin.backup+json' }), (req, res) => {
  const backup = record(req.body);
  if (backup.format !== format || backup.version !== 1) invalid();
  const data = record(backup.data);
  const favorites = ids(data.favorites);
  const history = ids(data.history);
  const playlists = list(data.playlists, 100, readPlaylist);
  if (new Set(playlists.map(item => item.id)).size !== playlists.length) invalid();
  const activity = list(data.activity, 500, readActivity);
  const quality = string(data.quality);
  if (!qualities.includes(quality)) invalid();
  const downloads = readDownloadPreferences(data.downloads);
  const tracks = list(data.onlineTracks, 100_000, readOnlineTrack);
  const related = new Set([...favorites, ...history, ...playlists.flatMap(item => item.trackIds)]);
  if (tracks.some(track => !related.has(track.id))) invalid();

  const restoredSources = data.sources === undefined ? undefined : list(data.sources, 20, readSource);
  if (restoredSources && (
    new Set(restoredSources.map(({ entry }) => entry.id)).size !== restoredSources.length ||
    new Set(restoredSources.map(({ script }) => script)).size !== restoredSources.length
  )) invalid();

  transaction(() => {
    if (restoredSources) {
      for (const entry of sources) deleteScript(entry.id);
      for (const { entry, script } of restoredSources) writeScript(entry.id, script);
      replaceRecords('sources', restoredSources.map(({ entry }) => entry));
    }
    for (const track of tracks) upsertRecord('online_tracks', track);
    saveIds('favorites', favorites);
    saveIds('history', history);
    savePlaylists(playlists);
    saveSetting('source-activity', activity);
    saveSetting('sources', { ...sourceSettings, quality });
    const current = loadSetting('downloads', {});
    saveSetting('downloads', { ...current, ...downloads });
  });

  for (const track of tracks) onlineTracks[track.id] = track;
  if (restoredSources) applyRestoredSources(restoredSources.map(({ entry }) => entry));
  state.favorites = favorites;
  state.history = history;
  sourceSettings.quality = quality;
  reloadPlaylists();
  reloadSourceActivity();
  reloadDownloadSettings();
  res.json({ ok: true });
});
