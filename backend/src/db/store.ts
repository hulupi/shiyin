import type { Directory, Track } from '../contracts.js';
import { loadRecords, loadSetting, replaceRecords, loadIds, saveIds, transaction } from './database.js';
export { root, dataDir } from '../config/paths.js';
export interface StoredTrack extends Track { path: string; lyricPath?: string; hasEmbeddedLyrics?: boolean; coverPath?:string; hasEmbeddedCover?:boolean }
export const state={directories:loadRecords<Directory>('directories'),tracks:loadRecords<StoredTrack>('local_tracks'),favorites:loadIds('favorites'),history:loadIds('history')};
export const downloadDirectories = loadSetting<Directory[]>('downloadDirectories', []);
export function findStorageDirectory(id: string) {
  return state.directories.find(directory => directory.id === id) ??
    downloadDirectories.find(directory => directory.id === id);
}
export async function save(){transaction(()=>{replaceRecords('directories',state.directories);replaceRecords('local_tracks',state.tracks);saveIds('favorites',state.favorites);saveIds('history',state.history);});}
export function publicTrack({ path: _path, lyricPath: _lyric, hasEmbeddedLyrics: _embedded, coverPath:_cover, hasEmbeddedCover:_embeddedCover, ...track }: StoredTrack) { return {...track,audioVariants:track.audioVariants||[{quality:track.format==='FLAC'?'flac':'local',format:track.format,size:track.size}]}; }
