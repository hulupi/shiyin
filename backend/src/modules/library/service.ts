import { access, realpath, readdir, stat, lstat, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseFile } from 'music-metadata';
import { state, save, findStorageDirectory, downloadDirectories, type StoredTrack } from '../../db/store.js';
import { recordActivityException } from '../sources/activity.js';
import type { ScanStatus } from '../../contracts.js';
function audioVariants(file:string,size:number,metadata:Awaited<ReturnType<typeof parseFile>>){const format=path.extname(file).slice(1).toUpperCase();return [{quality:format==='FLAC'?(metadata.format.bitsPerSample&&metadata.format.bitsPerSample>16?'flac24bit':'flac'):'local',format,size,bitrate:metadata.format.bitrate?Math.round(metadata.format.bitrate/1000):undefined}];}
const extensions = new Set(['.mp3','.flac','.m4a','.aac','.wav','.ogg','.opus']);
export const scan: ScanStatus = { running: false, scanned: 0, failed: 0, errors: [] };
let cancelled = false;
let deletingFile = false;
export function within(root: string, file: string) { const relative = path.relative(root, file); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); }
export async function addDirectory(input: string, replaceId?: string) {
  if (!path.isAbsolute(input)) throw new Error('请输入 NAS 上的绝对目录路径');
  const directory = await realpath(input);
  await access(directory, constants.R_OK);
  if (!(await stat(directory)).isDirectory()) throw new Error('路径不是目录');
  if (scan.running || deletingFile) throw new Error('扫描或文件删除正在进行，请稍后重试');

  const previous = state.directories.find(item => item.id === replaceId);
  if (replaceId && !previous) throw new Error('音乐存储目录已变更，请刷新后重试');
  if (!replaceId && state.directories.length) throw new Error('只能设置一个音乐存储目录，请先移除现有目录');
  if (previous?.path === directory) return previous;

  const entry = { id: randomUUID(), path: directory, addedAt: new Date().toISOString() };
  const oldDirectories = state.directories;
  const oldTracks = state.tracks;
  state.directories = oldDirectories.map(item => item.id === replaceId ? entry : item);
  if (!previous) state.directories.push(entry);
  state.tracks = oldTracks.filter(track => track.directoryId !== replaceId);
  try {
    await save();
  } catch (error) {
    state.directories = oldDirectories;
    state.tracks = oldTracks;
    throw error;
  }
  return entry;
}
export async function authorizedFile(track: StoredTrack, lyric:boolean|'cover' = false) {
  const file = await realpath(lyric==='cover'?track.coverPath||'':lyric?track.lyricPath||'':track.path);
  let allowed = false;
  for (const directory of state.directories) { if (within(await realpath(directory.path).catch(() => '\0'), file)) allowed = true; }
  const downloadDirectory = downloadDirectories.find(directory => directory.id === track.directoryId);
  if (downloadDirectory && within(downloadDirectory.path, file)) allowed = true;
  if (!allowed || !(await stat(file)).isFile()) throw new Error('文件不存在或已取消目录授权');
  return file;
}
export function cancelScan() { cancelled = true; }
interface DownloadIndexOptions {
  track?: Pick<StoredTrack, 'title' | 'artist' | 'album' | 'duration'>;
  onWarning?: (message: string) => void;
}
export async function indexDownloadedFile(file:string,directoryId:string,options:DownloadIndexOptions={}) {
  const directory=findStorageDirectory(directoryId);
  if(!directory||!within(directory.path,await realpath(file)))throw new Error('下载目录已取消授权');
  // Retry optional artwork parsing only; never replace a parse failure with cached metadata.
  // Keep filesystem and database errors outside this metadata-only fallback.
  let metadata: Awaited<ReturnType<typeof parseFile>>;
  try { metadata = await parseFile(file); }
  catch {
    metadata = await parseFile(file, { skipCovers: true });
    options.onWarning?.('音频已保存，部分内嵌信息无法读取，已使用歌曲信息入库');
  }
  const info=await stat(file);
  const base=file.slice(0,-path.extname(file).length);
  const lyricPath=await access(base+'.lrc').then(()=>base+'.lrc').catch(()=>undefined);
  let coverPath:string|undefined;for(const extension of ['jpg','png','webp','gif','avif'])if(await access(base+'.'+extension).then(()=>true).catch(()=>false)){coverPath=base+'.'+extension;break;}
  const fallback=path.basename(file,path.extname(file)).split(' - ');
  const id = createHash('sha256').update(file).digest('hex').slice(0, 24);
  const previous = state.tracks.find(item => item.id === id);
  const addedAt = previous ? previous.addedAt : Date.now();
  const track:StoredTrack={id,addedAt,directoryId,path:file,title:metadata.common.title||options.track?.title||fallback.slice(fallback.length>1?1:0).join(' - '),artist:metadata.common.artist||options.track?.artist||(fallback.length>1?fallback[0]:'未知歌手'),album:metadata.common.album||options.track?.album||'未知专辑',duration:metadata.format.duration||options.track?.duration||0,format:path.extname(file).slice(1).toUpperCase(),size:info.size,audioVariants:audioVariants(file,info.size,metadata),modified:info.mtimeMs,hasCover:Boolean(coverPath||metadata.common.picture?.length),hasEmbeddedCover:Boolean(metadata.common.picture?.length),coverPath,lyricPath,hasLyrics:Boolean(lyricPath||metadata.common.lyrics?.length),hasEmbeddedLyrics:Boolean(metadata.common.lyrics?.length),available:true};
  state.tracks=state.tracks.filter(item=>item.id!==track.id);state.tracks.push(track);await save();return track;
}
export function startScan() {
  if (scan.running || deletingFile) throw new Error('扫描或文件删除正在进行，请稍后重试');
  cancelled = false; Object.assign(scan, { running: true, scanned: 0, failed: 0, errors: [], startedAt: new Date().toISOString(), finishedAt: undefined });
  void run().then(() => {
    if (scan.failed) recordActivityException('音乐库扫描异常', '有 ' + scan.failed + ' 项无法读取，已扫描 ' + scan.scanned + ' 首。请检查目录权限、文件是否存在及音频格式。');
  }).catch(error => {
    scan.errors.push(String(error.message));
    recordActivityException('音乐库扫描中断', '扫描或索引保存失败，请检查音乐目录和应用数据目录后重新扫描。');
  }).finally(() => {
    scan.running = false;
    scan.finishedAt = new Date().toISOString();
  });
}
async function run() {
  const addedAt = Date.now();
  const found = new Map<string, StoredTrack>();
  const initialTracks = new Set(state.tracks);
  const old = new Map(state.tracks.map(t => [t.path, t]));
  const unreadableFolders = new Set<string>();
  const unreadableFiles = new Set<string>();
  function failure(message: string) { scan.failed++; if (scan.errors.length < 50) scan.errors.push(message); }
  for (const directory of [...state.directories]) {
    if (cancelled) break;
    async function walk(folder: string) {
      const entries = await readdir(folder, { withFileTypes: true });
      const lyrics = new Map(entries.filter(e => e.isFile() && path.extname(e.name).toLowerCase() === '.lrc').map(e => [path.basename(e.name, path.extname(e.name)).toLowerCase(), path.join(folder, e.name)]));
      const covers=new Map(entries.filter(e=>e.isFile()&&['.jpg','.jpeg','.png','.webp','.gif','.avif'].includes(path.extname(e.name).toLowerCase())).map(e=>[path.basename(e.name,path.extname(e.name)).toLowerCase(),path.join(folder,e.name)]));
      for (const entry of entries) {
        if (cancelled) return;
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) { try { await walk(file); } catch { unreadableFolders.add(file); failure('无法读取子目录：' + entry.name); } continue; }
        if (!entry.isFile() || !extensions.has(path.extname(file).toLowerCase()) || found.has(file)) continue;
        try {
          const info = await stat(file); const previous = old.get(file);
          const lyricPath = lyrics.get(path.basename(file, path.extname(file)).toLowerCase());
          const coverPath = covers.get(path.basename(file,path.extname(file)).toLowerCase());
          if (previous && previous.size === info.size && previous.modified === info.mtimeMs && previous.hasEmbeddedLyrics !== undefined && previous.hasEmbeddedCover !== undefined && previous.audioVariants !== undefined) { found.set(file, { ...previous, directoryId: directory.id, lyricPath, coverPath, hasCover:Boolean(coverPath||previous.hasEmbeddedCover), hasLyrics: Boolean(lyricPath) || Boolean(previous.hasEmbeddedLyrics), available: true }); }
          else {
            const metadata = await parseFile(file); const parts = path.basename(file, path.extname(file)).split(' - ');
            found.set(file, { id: createHash('sha256').update(file).digest('hex').slice(0,24), directoryId: directory.id, addedAt: previous ? previous.addedAt : addedAt, path: file, title: metadata.common.title || parts.slice(parts.length > 1 ? 1 : 0).join(' - '), artist: metadata.common.artist || (parts.length > 1 ? parts[0] : '未知歌手'), album: metadata.common.album || '未知专辑', duration: metadata.format.duration || 0, format: path.extname(file).slice(1).toUpperCase(), size: info.size, audioVariants:audioVariants(file,info.size,metadata), modified: info.mtimeMs, hasCover: Boolean(coverPath||metadata.common.picture?.length), coverPath, hasEmbeddedCover:Boolean(metadata.common.picture?.length), hasLyrics: Boolean(lyricPath || metadata.common.lyrics?.length), hasEmbeddedLyrics: Boolean(metadata.common.lyrics?.length), lyricPath, available: true });
          }
          scan.scanned++;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') unreadableFiles.add(file);
          failure('无法读取音频：' + entry.name);
        }
      }
    }
    try { await access(directory.path, constants.R_OK); await walk(directory.path); }
    catch { unreadableFolders.add(directory.path); failure('目录暂不可用：' + directory.path); }
  }
  if (cancelled) return;
  const retained = new Map<string, StoredTrack>();
  for (const previous of initialTracks) {
    if (cancelled) return;
    if (found.has(previous.path)) continue;
    const downloadDirectory = downloadDirectories.find(directory => directory.id === previous.directoryId);
    if (downloadDirectory) {
      const rootReadable = await access(downloadDirectory.path, constants.R_OK).then(() => true, () => false);
      try {
        await authorizedFile(previous);
        retained.set(previous.id, { ...previous, available: true });
      } catch (error) {
        if (!rootReadable || (error as NodeJS.ErrnoException).code !== 'ENOENT') {
          retained.set(previous.id, { ...previous, available: false });
        }
      }
    } else if (unreadableFiles.has(previous.path) ||
      [...unreadableFolders].some(folder => within(folder, previous.path))) {
      retained.set(previous.id, { ...previous, available: false });
    }
  }
  if (cancelled) return;
  const active = new Set([...state.directories, ...downloadDirectories].map(directory => directory.id));
  const indexed = new Map([...found.values(), ...retained.values()].map(track => [track.id, track]));
  // Prefer the records written by downloads that finished during this scan.
  for (const track of state.tracks) {
    if (!initialTracks.has(track)) indexed.set(track.id, track);
  }
  const tracks = [...indexed.values()].filter(track => active.has(track.directoryId));
  state.tracks = tracks; await save();
}

// Only remove regular files inside an authorized music directory, never directories or links.
export async function deleteTrackFiles(id:string) {
  if(scan.running||deletingFile)throw new Error('请等待扫描或文件删除结束后重试');
  const track=state.tracks.find(item=>item.id===id);
  if(!track)throw new Error('歌曲不存在');
  deletingFile=true;
  try {
    const audio=await authorizedFile(track);
    if(!(await lstat(track.path)).isFile())throw new Error('不支持删除符号链接');
    const folder=path.dirname(audio),stem=path.basename(audio,path.extname(audio));
    const entries=await readdir(folder,{withFileTypes:true});
    const sideExtensions=new Set(['.lrc','.jpg','.jpeg','.png','.webp','.gif','.avif']);
    const sameStem=(name:string)=>path.basename(name,path.extname(name)).toLowerCase()===stem.toLowerCase();
    // Alternate encodings of the same song may share sidecar files, even when not indexed.
    const shared=entries.some(entry=>entry.isFile()&&sameStem(entry.name)&&extensions.has(path.extname(entry.name).toLowerCase())&&path.join(folder,entry.name)!==audio);
    const candidates=shared?[]:entries.filter(entry=>entry.isFile()&&sameStem(entry.name)&&sideExtensions.has(path.extname(entry.name).toLowerCase())).map(entry=>path.join(folder,entry.name));
    const sidecars:string[]=[];
    for(const file of candidates){
      const resolved=await realpath(file);
      if(!within(folder,resolved)||!(await lstat(file)).isFile())throw new Error('关联文件路径无效');
      const used=state.tracks.some(item=>item.id!==id&&[item.coverPath,item.lyricPath].some(value=>value&&path.resolve(value)===path.resolve(file)));
      if(!used)sidecars.push(file);
    }
    await unlink(audio); // If Windows denies removal of an open file, leave metadata and sidecars intact.
    const warnings:string[]=[];
    for(const file of sidecars){try{await unlink(file);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')warnings.push('未能删除关联文件：'+path.basename(file));}}
    state.tracks=state.tracks.filter(item=>item.id!==id);
    state.favorites=state.favorites.filter(value=>value!==id);
    state.history=state.history.filter(value=>value!==id);
    await save();
    return {ok:true,warnings};
  } finally {deletingFile=false;}
}
