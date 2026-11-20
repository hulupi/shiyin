import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { createWriteStream, constants } from 'node:fs';
import { realpath, access, statfs, copyFile, link, unlink, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { state, publicTrack, downloadDirectories, findStorageDirectory } from '../../db/store.js';
import { indexDownloadedFile, within } from '../library/service.js';
import { loadRecords, replaceRecords, loadSetting, saveSetting, transaction } from '../../db/database.js';
import { getOnlineTrack, saveOnlineTrack, publicOnlineTrack, type OnlineTrack } from '../catalog/service.js';
import { resolveOnlineAudio, bindOnlineLocal, hasLocalCopy, matchesLocalTrack } from '../playback/online.js';
import { openPublicUrl } from '../sources/network.js';
import { enrichAudio, saveSidecars } from './enrich.js';
import { recordActivityException, sourceActivity } from '../sources/activity.js';

const filenameFormats = ['artist-title', 'title-artist'] as const;
type FilenameFormat = typeof filenameFormats[number];

export function isFilenameFormat(value: unknown): value is FilenameFormat {
  return filenameFormats.some(format => format === value);
}

export function isPlaybackDownloadPercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100;
}

interface DownloadTask { id:string;trackId:string;title:string;artist:string;directoryId:string;quality:string;filenameFormat?:FilenameFormat;saveLyrics?:boolean;embedMetadata?:boolean;actualQuality?:string;format?:string;status:'queued'|'resolving'|'downloading'|'tagging'|'completed'|'failed'|'cancelled';bytes:number;total:number;createdAt:string;path?:string;error?:string;sourceName?:string;lyricPath?:string;coverPath?:string;embeddedLyrics?:boolean;embeddedCover?:boolean;warnings?:string[] }
const tasks:DownloadTask[]=loadRecords<DownloadTask>('downloads');
for(const task of tasks)if(['resolving','downloading','tagging'].includes(task.status)){task.status=task.path?'completed':'failed';task.error=task.path?undefined:'服务已重启，请重试下载';}
replaceRecords('downloads',tasks);
async function save(){replaceRecords('downloads',tasks);}
const running=new Map<string,AbortController>();
function cleanName(value:string){return value.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,120)||'歌曲';}
function pump(){for(const task of tasks){if(running.size>=2)break;if(task.status!=='queued'||running.has(task.id))continue;const controller=new AbortController();running.set(task.id,controller);void run(task,controller.signal).catch(error=>{task.status='failed';task.error=error instanceof Error?error.message:'任务保存失败';}).finally(()=>{running.delete(task.id);pump();});}}
const downloadQualities = ['flac24bit', 'flac', '320k', '128k'];
const defaultSettings = { filenameFormat: 'title-artist' as FilenameFormat, directory: '', quality: 'flac24bit', saveLyrics: true, embedMetadata: true, autoDownloadFavorites: false, autoDownloadPlayback: false, playbackDownloadPercent: 90 };
let downloadSettings = { ...defaultSettings, ...loadSetting<Partial<typeof defaultSettings>>('downloads', {}) };

export function downloadPreferences() {
  const { directory: _directory, ...preferences } = downloadSettings;
  return preferences;
}

export function reloadDownloadSettings() {
  downloadSettings = { ...defaultSettings, ...loadSetting<Partial<typeof defaultSettings>>('downloads', {}) };
}

async function writableDirectory(input: string) {
  if (!path.isAbsolute(input)) throw new Error('请输入下载保存目录的绝对路径');
  const root = await realpath(input);
  if (!(await stat(root)).isDirectory()) throw new Error('下载保存路径必须是目录');
  await access(root, constants.R_OK | constants.W_OK);
  return root;
}

async function directoryPath(id: string) {
  const directory = findStorageDirectory(id);
  if (!directory) throw new Error('保存目录已移除，请检查下载设置');
  const root = await writableDirectory(directory.path);
  if (downloadDirectories.some(item => item.id === id) && root !== directory.path)
    throw new Error('下载保存目录已改变，请重新保存下载设置');
  return root;
}
async function run(task:DownloadTask,signal:AbortSignal) {
  const activity = sourceActivity('download', { ...task, id: task.trackId }, task.quality);
  let temporary='';
  try {
    const root=await directoryPath(task.directoryId),track=getOnlineTrack(task.trackId);const disk=await statfs(root);if(disk.bavail*disk.bsize<8*1024*1024)throw new Error('磁盘剩余空间不足');
    temporary=path.join(root,`.shiyin-${task.id}.part`);await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});temporary='';
    Object.assign(task,{status:'resolving',error:undefined,bytes:0,total:0,actualQuality:undefined,sourceName:undefined,format:undefined});
    await save();
    const rejectedSourcesByQuality=new Map<string,Set<string>>();
    let quality=task.quality,attempts=0,completed=false;
    // A different source always starts a fresh temporary file, never appends.
    while(!completed) {
      signal.throwIfAborted();
      const result=await resolveOnlineAudio(track,quality,[],signal,rejectedSourcesByQuality,activity);quality=result.quality;
      temporary=path.join(root,`.shiyin-${task.id}.part`);
      try {
        const response=await openPublicUrl(result.url,{signal});
        if(response.statusCode!==200||/text\/|json|xml/i.test(response.headers['content-type']||'')){response.destroy();throw new Error('下载地址不是可用的音频文件');}
        const total=Number(response.headers['content-length'])||0;
        if(total>10*1024**3||total>disk.bavail*disk.bsize){response.destroy();throw new Error('文件过大或磁盘空间不足');}
        const chunks=response[Symbol.asyncIterator]();
        try {
          const prefix:Buffer[]=[];
          let prefixSize=0;
          while(prefixSize<42){
            const chunk=await chunks.next();
            if(chunk.done)break;
            prefix.push(chunk.value);
            prefixSize+=chunk.value.length;
          }
          if(!prefixSize)throw new Error('音源返回空文件');
          if(result.quality==='flac'||result.quality==='flac24bit'){
            const header=Buffer.concat(prefix);
            if(header.length<42||header.toString('ascii',0,4)!=='fLaC'||(header[4]&127)!==0||header.readUIntBE(5,3)!==34){
              throw new Error('音源返回的文件不是 FLAC');
            }
            const bitsPerSample=((header[20]&1)<<4 | header[21]>>4)+1;
            if(result.quality==='flac24bit'&&bitsPerSample<24)throw new Error('音源返回的 FLAC 未达到 24 bit');
          }
          Object.assign(task,{status:'downloading',actualQuality:result.quality,sourceName:result.sourceName,bytes:0,total});
          await save();
          let lastSave=Date.now();
          await pipeline(async function*(){
            for(const chunk of prefix)yield chunk;
            for(let chunk=await chunks.next();!chunk.done;chunk=await chunks.next())yield chunk.value;
          },async function* (audio){
            for await(const chunk of audio){
              task.bytes+=chunk.length;
              if(task.bytes>10*1024**3)throw new Error('文件超过下载大小限制');
              if(Date.now()-lastSave>1000){lastSave=Date.now();await save();}
              yield chunk;
            }
          },createWriteStream(temporary,{flags:'wx'}),{signal});
          if(total&&task.bytes!==total)throw new Error('音频文件未下载完整');
        } finally {
          response.destroy();
        }
        const metadata=await parseFile(temporary,{skipCovers:true});
        const container=(metadata.format.container||'').toLowerCase();
        const extension=container.includes('flac')?'flac':container.includes('mpeg-4')||container.includes('mp4')?'m4a':container.includes('wave')?'wav':container.includes('ogg')?'ogg':container.includes('adts')?'aac':container.includes('mpeg')?'mp3':null;
        if(!extension)throw new Error('无法识别下载文件的音频格式');
        if((result.quality==='flac'||result.quality==='flac24bit')&&extension!=='flac'){
          throw new Error('音源返回的文件不是 FLAC');
        }
        if(result.quality==='flac24bit'&&(metadata.format.bitsPerSample??0)<24){
          throw new Error('音源返回的 FLAC 未达到 24 bit');
        }
        Object.assign(task,{status:'tagging',total:task.bytes});
        await save();
        const assets=await enrichAudio(temporary,extension,track,signal,task);task.warnings=assets.warnings;task.embeddedLyrics=assets.embeddedLyrics;task.embeddedCover=assets.embeddedCover;
        signal.throwIfAborted();
        const authorizedRoot=await directoryPath(task.directoryId);if(authorizedRoot!==root)throw new Error('保存目录授权已改变');
        const format = task.filenameFormat ?? downloadSettings.filenameFormat;
        const parts = format === 'title-artist'
          ? [track.title, track.artist]
          : [track.artist, track.title];
        const base = cleanName(parts.join(' - '));
        let destination = '';
        for(let number=0;number<100;number++){
          const candidate=path.join(root,`${base}${number?` (${number+1})`:''}.${extension}`);if(!within(root,candidate))throw new Error('文件路径无效');
          try{try{await link(temporary,candidate);}catch(error){if(!['ENOTSUP','EXDEV','EPERM'].includes((error as NodeJS.ErrnoException).code||''))throw error;await copyFile(temporary,candidate,constants.COPYFILE_EXCL);}destination=candidate;break;}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
        }
        if(!destination)throw new Error('同名文件过多，请整理下载目录');
        await unlink(temporary);temporary='';task.path=destination;task.format=extension.toUpperCase();const finished=await stat(destination);task.bytes=finished.size;task.total=finished.size;
        Object.assign(task,await saveSidecars(destination,assets,task.saveLyrics,task.embedMetadata !== false));
        const indexed=await indexDownloadedFile(destination,task.directoryId);await bindOnlineLocal(track,indexed.id);
        task.status='completed';completed=true;await save();
        activity.record('completed', {
          source: result.sourceName, quality: result.quality, format: task.format,
          bitrate: metadata.format.bitrate ? Math.round(metadata.format.bitrate / 1000) : undefined,
        });
      }catch(error){
        if(temporary)await unlink(temporary).catch(()=>{});temporary='';signal.throwIfAborted();
        if(task.status==='tagging'||task.path||['ENOSPC','EACCES','EROFS','EIO'].includes((error as NodeJS.ErrnoException).code||''))throw error;
        activity.record('source-failed', { source: result.sourceName, quality: result.quality, reason: 'transfer' });
        const rejected=rejectedSourcesByQuality.get(result.quality)??new Set<string>();
        rejected.add(result.sourceId);
        rejectedSourcesByQuality.set(result.quality,rejected);
        if(++attempts>=20)throw error;
        Object.assign(task,{status:'resolving',bytes:0,total:0,actualQuality:undefined,sourceName:undefined});
        await save();
      }
    }
  }catch(error){task.status=signal.aborted?'cancelled':'failed';task.error=signal.aborted?'下载已取消':error instanceof Error?error.message:'下载失败';activity.record(task.status,{quality:task.actualQuality,format:task.format});await save();}
  finally{if(temporary)await unlink(temporary).catch(()=>{});}
}
export function cancelDirectoryDownloads(directoryId:string){for(const task of tasks)if(task.directoryId===directoryId){running.get(task.id)?.abort();if(task.status==='queued')task.status='cancelled';}void save().catch(()=>{});}
export const downloadRouter=Router();
downloadRouter.get('/downloads/settings', (_req, res) => res.json(downloadSettings));
downloadRouter.patch('/downloads/settings', async (req, res) => {
  const { directory, quality, filenameFormat, saveLyrics, embedMetadata, autoDownloadFavorites,
    autoDownloadPlayback, playbackDownloadPercent } = req.body ?? {};
  if ((directory !== undefined && typeof directory !== 'string') ||
      (quality !== undefined && !downloadQualities.includes(quality)) ||
      (filenameFormat !== undefined && !isFilenameFormat(filenameFormat)) ||
      (playbackDownloadPercent !== undefined && !isPlaybackDownloadPercent(playbackDownloadPercent)) ||
      [saveLyrics, embedMetadata, autoDownloadFavorites, autoDownloadPlayback].some(value => value !== undefined && typeof value !== 'boolean'))
    return res.status(400).json({ error: '无效的下载设置' });

  const root = directory?.trim() ? await writableDirectory(directory.trim()) : directory?.trim();
  const entry = root && !downloadDirectories.some(item => item.path === root)
    ? { id: randomUUID(), path: root, addedAt: new Date().toISOString() }
    : null;
  const settings = {
    directory: root ?? downloadSettings.directory,
    quality: quality ?? downloadSettings.quality,
    filenameFormat: filenameFormat ?? downloadSettings.filenameFormat,
    saveLyrics: saveLyrics ?? downloadSettings.saveLyrics,
    embedMetadata: embedMetadata ?? downloadSettings.embedMetadata,
    autoDownloadFavorites: autoDownloadFavorites ?? downloadSettings.autoDownloadFavorites,
    autoDownloadPlayback: autoDownloadPlayback ?? downloadSettings.autoDownloadPlayback,
    playbackDownloadPercent: playbackDownloadPercent ?? downloadSettings.playbackDownloadPercent,
  };
  transaction(() => {
    if (entry) saveSetting('downloadDirectories', [...downloadDirectories, entry]);
    saveSetting('downloads', settings);
  });
  if (entry) downloadDirectories.push(entry);
  downloadSettings = settings;
  res.json(settings);
});
downloadRouter.get('/downloads/directories',(_req,res)=>res.json(state.directories));
downloadRouter.get('/downloads',(_req,res)=>res.json([...tasks].reverse().map(task=>{const local=task.status==='completed'&&state.tracks.find(track=>track.path===task.path);let track=null;try{track=local?publicTrack(local):publicOnlineTrack(getOnlineTrack(task.trackId));}catch{}return {...task,track};})));
const activeStatuses = ['queued','resolving','downloading','tagging'];
downloadRouter.delete('/downloads',(_req,res)=>{
  const remaining=tasks.filter(task=>activeStatuses.includes(task.status)||running.has(task.id));
  const removed=tasks.length-remaining.length;
  if(removed){
    replaceRecords('downloads',remaining);
    tasks.splice(0,tasks.length,...remaining);
  }
  res.json({removed});
});

async function queueDownload(track: OnlineTrack, options: {directoryId?:unknown;quality?:unknown} = {}, automatic = false) {
  const sameSong = (task: DownloadTask) => {
    if (task.trackId === track.id) return true;
    try { return matchesLocalTrack(getOnlineTrack(task.trackId), track); } catch { return false; }
  };
  if (automatic && (await hasLocalCopy(track) || (await Promise.all(tasks.filter(task => task.path && sameSong(task)).map(async task =>
    stat(task.path!).then(file => file.isFile(), () => false)
  ))).some(Boolean))) return;

  const settings = downloadSettings;
  const defaultDirectory = settings.directory
    ? downloadDirectories.find(item => item.path === settings.directory)
    : state.directories[0];
  const directoryId = String(options.directoryId || defaultDirectory?.id || '');
  const quality = String(options.quality || settings.quality);
  if (!directoryId) throw new Error('请先在设置中配置下载保存目录或音乐存储目录');
  if (!downloadQualities.includes(quality)) throw new Error('无效音质');
  await directoryPath(directoryId);
  await saveOnlineTrack(track);
  if(automatic && tasks.some(task=>activeStatuses.includes(task.status)&&sameSong(task)))return;
  if(tasks.filter(task=>activeStatuses.includes(task.status)).length>=200)throw new Error('待处理下载任务已达上限');
  if(tasks.some(task=>task.trackId===track.id&&task.directoryId===directoryId&&task.quality===quality&&activeStatuses.includes(task.status)))throw new Error('相同歌曲和音质已在下载队列中');
  const task:DownloadTask={id:randomUUID(),trackId:track.id,title:track.title,artist:track.artist,directoryId,quality,filenameFormat:settings.filenameFormat,saveLyrics:settings.saveLyrics,embedMetadata:settings.embedMetadata,status:'queued',bytes:0,total:0,createdAt:new Date().toISOString()};tasks.push(task);await save();pump();return task;
}

export async function downloadOnFavorite(track?: OnlineTrack) {
  if (!downloadSettings.autoDownloadFavorites) return;
  if (!track) return {status:"skipped"};
  try { return await queueDownload(track, {}, true) ? {status:'queued'} : {status:'skipped'}; }
  catch (error) {
    recordActivityException('收藏时自动下载失败', '歌曲未加入下载队列，请检查下载目录和队列状态。');
    return { status: 'error', message: error instanceof Error ? error.message : '无法加入下载队列' };
  }
}

downloadRouter.post('/downloads/playback', async (req, res) => {
  const { trackId, percent } = req.body ?? {};
  if (typeof trackId !== 'string' || !trackId.startsWith('online:') ||
      typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    return res.status(400).json({ error: '无效的播放进度' });
  }
  const settings = downloadSettings;
  if (!settings.autoDownloadPlayback || percent < settings.playbackDownloadPercent) {
    return res.json({ status: 'ineligible' });
  }
  const task = await queueDownload(getOnlineTrack(trackId), {}, true);
  res.json({ status: task ? 'queued' : 'skipped' });
});

downloadRouter.post('/downloads/batch',async(req,res)=>{
  const ids: unknown= req.body.trackIds;
  if(!Array.isArray(ids)||!ids.length||ids.length>200||ids.some(id=>typeof id!=='string'))return res.status(400).json({error:'请选择 1–200 首歌曲'});
  let queued=0,skipped=0,failed=0,firstError='';
  for(const id of new Set<string>(ids)){
    if(state.tracks.some(track=>track.id===id)){skipped++;continue;}
    try {if(await queueDownload(getOnlineTrack(id),{},true))queued++;else skipped++;}
    catch(error){failed++;firstError||=error instanceof Error?error.message:'无法加入下载队列';}
  }
  res.json({queued,skipped,failed,firstError});
});

downloadRouter.post('/downloads',async(req,res)=>{
  const track = getOnlineTrack(String(req.body.trackId || ''));
  res.status(201).json(await queueDownload(track, req.body));
});
downloadRouter.post('/downloads/cancel-queued',async(req,res)=>{
  const ids=req.body.ids;
  if(!Array.isArray(ids)||ids.length>200||ids.some(id=>typeof id!=='string'))return res.status(400).json({error:'无效的任务列表'});
  const selected=new Set(ids);
  let cancelled=0;
  for(const task of tasks)if(task.status==='queued'&&!running.has(task.id)&&selected.has(task.id)){
    task.status='cancelled';cancelled++;
  }
  await save();
  res.json({cancelled,skipped:selected.size-cancelled});
});
downloadRouter.post('/downloads/:id/cancel',async(req,res)=>{const task=tasks.find(item=>item.id===req.params.id);if(!task)return res.status(404).json({error:'任务不存在'});if(task.status==='completed')throw new Error('已完成任务不能取消');running.get(task.id)?.abort();task.status='cancelled';await save();res.json(task);});
downloadRouter.post('/downloads/:id/retry',async(req,res)=>{const task=tasks.find(item=>item.id===req.params.id);if(!task)return res.status(404).json({error:'任务不存在'});if(running.has(task.id)||!['failed','cancelled'].includes(task.status))throw new Error('该任务不能重试');await directoryPath(task.directoryId);task.status='queued';task.error=undefined;task.path=undefined;task.warnings=[];task.lyricPath=undefined;task.coverPath=undefined;task.embeddedLyrics=false;task.embeddedCover=false;await save();res.json(task);pump();});
downloadRouter.post('/downloads/:id/enrich',async(req,res)=>{
  const task=tasks.find(item=>item.id===req.params.id);if(!task||task.status!=='completed'||!task.path)return res.status(400).json({error:'请选择已完成的下载任务'});
  if(running.size>=2)throw new Error('任务繁忙，请稍后补全');
  const root=await directoryPath(task.directoryId),file=await realpath(task.path);if(!within(root,file))throw new Error('目录授权已失效');
  const track=getOnlineTrack(task.trackId),controller=new AbortController();running.set(task.id,controller);task.status='tagging';task.error=undefined;await save();
  const wait=req.query.wait==='1';
  if(!wait)res.status(202).json(task);
  const work=(async()=>{
    try{const assets=await enrichAudio(file,path.extname(file).slice(1).toLowerCase(),track,controller.signal);await directoryPath(task.directoryId);controller.signal.throwIfAborted();const sidecars=await saveSidecars(file,assets,true,true);task.lyricPath=sidecars.lyricPath??task.lyricPath;task.coverPath=sidecars.coverPath??task.coverPath;task.warnings=assets.warnings;task.embeddedLyrics=assets.embeddedLyrics;task.embeddedCover=assets.embeddedCover;const info=await stat(file);task.bytes=info.size;task.total=info.size;const indexed=await indexDownloadedFile(file,task.directoryId);await bindOnlineLocal(track,indexed.id);}
    catch(error){task.warnings=[controller.signal.aborted?'补全已取消，原有音频保留':error instanceof Error?error.message:'歌词封面补全失败'];}
    finally{task.status='completed';await save().catch(()=>{});running.delete(task.id);pump();}
  })();
  if(wait){await work;res.json(task);}
});
downloadRouter.get('/downloads/:id/lyrics',async(req,res)=>{const task=tasks.find(item=>item.id===req.params.id);if(!task?.lyricPath)return res.status(404).json({error:'歌词文件尚未保存'});const root=await directoryPath(task.directoryId),file=await realpath(task.lyricPath);if(!within(root,file))throw new Error('歌词目录授权失效');res.download(file,path.basename(file));});
downloadRouter.get('/downloads/:id/file',async(req,res)=>{const task=tasks.find(item=>item.id===req.params.id);if(!task||task.status!=='completed'||!task.path)return res.status(404).json({error:'文件不可用'});const root=await directoryPath(task.directoryId),file=await realpath(task.path);if(!within(root,file)||!(await stat(file)).isFile())throw new Error('文件已移除或目录授权失效');res.download(file,path.basename(file));});
setImmediate(pump);
