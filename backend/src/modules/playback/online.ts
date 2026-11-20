import { qqHotSearch } from '../catalog/hot-search.js';
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { state, publicTrack, type StoredTrack } from '../../db/store.js';
import { authorizedFile } from '../library/service.js';
import { sources, importSource, importSourceUrl, checkSource, removeSource, requestSource, saveSources, cancelSource, sourceSettings, saveSourceSettings } from '../sources/service.js';
import { loadBindings, saveBinding, removeLocalBindings } from '../../db/database.js';
import { SourceScheduler } from '../sources/scheduler.js';
import { clearSourceActivity, listSourceActivity, recordPlaybackOutcome, sourceActivity, type SourceActivity } from '../sources/activity.js';
import { getOnlineCover } from '../catalog/cover.js';
import { getOnlineLyrics } from '../lyrics/online.js';
import type { OnlineTrack } from '../catalog/service.js';
import { openPublicUrl, requestPublic, validateAudio } from '../sources/network.js';
import { searchCatalog, getOnlineTrack, onlineTracks, saveOnlineTrack, publicOnlineTrack, enrichOnlineTrack } from '../catalog/service.js';

import { searchAlbums, albumTracks, albumPlatforms, validAlbumId } from '../catalog/albums.js';

export const onlineRouter = Router();
const scheduler=new SourceScheduler();
const leases=new Map<string,{trackId:string;url:string;sourceId:string;expires:number}>();
const bindings=loadBindings();
export function clearLocalBindings(id:string){for(const key of Object.keys(bindings))if(bindings[key]===id)delete bindings[key];removeLocalBindings(id);}
const qualityOrder=['flac24bit','flac','320k','128k'];

export async function resolveOnlineAudio(track:OnlineTrack,quality:string,excluded:string[]=[],signal?:AbortSignal,rejectedSourcesByQuality?:ReadonlyMap<string,ReadonlySet<string>>,activity?:SourceActivity) {
  if(!qualityOrder.includes(quality))throw new Error('无效音质');
  signal?.throwIfAborted();
  const checkNetwork = () => {
    if (!Object.values(networkInterfaces()).some(addresses => addresses?.some(address => !address.internal)))
      throw new Error('拾音服务未连接网络，请检查服务所在设备的网络后重试');
  };
  checkNetwork();
  const qualities = qualityOrder.slice(qualityOrder.indexOf(quality));
  const enabled = sources.filter(entry => entry.enabled);
  if (!enabled.length) throw new Error('没有已启用的音源，请在设置中导入或启用音源');
  const compatible = enabled.filter(entry => {
    const capability = entry.capabilities[track.platform];
    return capability?.actions.includes('musicUrl') && capability.qualitys.some(item => qualities.includes(item));
  });
  if (!compatible.length) throw new Error('已启用音源不支持这首歌的平台或所选音质');
  let timedOut = false;
  const result = await scheduler.resolve(compatible.filter(entry=>!excluded.includes(entry.id)).map(entry=>({
    id:entry.id,get enabled(){return entry.enabled;},priority:entry.priority,
    platforms:Object.keys(entry.capabilities).filter(platform=>entry.capabilities[platform].actions.includes('musicUrl')),
    qualities:entry.capabilities[track.platform]?.qualitys||[],
    async resolve(request,signal){
      const result=await requestSource(entry,{source:track.platform,action:'musicUrl',info:{type:request.quality,musicInfo:track.musicInfo}},signal);
      if(typeof result!=='string')throw new Error('音源没有返回播放链接');return result;
    },
  })),{platform:track.platform,songId:track.songId},{qualities,signal,rejectedSourcesByQuality,validate:validateAudio,
    onAttempt: activity && ((id, quality) => activity.attempt(sourceName(id), quality)),
    onFailure: (id, quality, reason) => {
      timedOut ||= reason === 'timeout';
      activity?.record('source-failed', { source: sourceName(id), quality, reason });
    },
  }).catch(error => {
    signal?.throwIfAborted();
    checkNetwork();
    if (timedOut || error?.name === 'TimeoutError')
      throw new Error('音源取链超时，请检查拾音服务的网络后重试');
    if (error instanceof AggregateError)
      throw new Error('音源未能播放这首歌，请稍后重试或切换音源');
    throw error;
  });
  const name = sourceName(result.sourceId);
  activity?.record('resolved', { source: name, quality: result.quality });
  return { ...result, sourceName: name };
}

function sourceName(id: string) {
  return sources.find(entry => entry.id === id)?.name || '在线音源';
}

onlineRouter.get('/sources/activity', (_req, res) => res.json(listSourceActivity()));
onlineRouter.delete('/sources/activity', (_req, res) => {
  clearSourceActivity();
  res.sendStatus(204);
});
onlineRouter.post('/online/:id/playback-failed', (req, res) => {
  recordPlaybackOutcome(getOnlineTrack(req.params.id), req.body?.activityId, 'source-failed');
  res.sendStatus(204);
});
onlineRouter.get('/sources',(_req,res)=>res.json([...sources].sort((a,b)=>a.priority-b.priority)));
onlineRouter.get('/sources/settings',(_req,res)=>res.json(sourceSettings));
onlineRouter.patch('/sources/settings',async(req,res)=>{
  if(!qualityOrder.includes(req.body.quality))return res.status(400).json({error:'无效音质'});
  sourceSettings.quality=req.body.quality;await saveSourceSettings();res.json(sourceSettings);
});
onlineRouter.post('/sources/import', async (req, res) => {
  const { script, url } = req.body ?? {};
  if (!(typeof script === 'string' && url === undefined) && !(typeof url === 'string' && script === undefined))
    return res.status(400).json({ error: '请选择 UTF-8 的 .js 音源文件或填写脚本链接' });
  const controller = new AbortController();
  res.once('close', () => controller.abort());
  const entry = typeof url === 'string'
    ? await importSourceUrl(url, controller.signal)
    : await importSource(script, controller.signal);
  res.status(201).json(entry);
});
onlineRouter.patch('/sources/:id',async(req,res)=>{
  const entry=sources.find(item=>item.id===req.params.id);if(!entry)return res.status(404).json({error:'音源不存在'});
  if(typeof req.body.enabled==='boolean'){entry.enabled=req.body.enabled;if(!entry.enabled)cancelSource(entry.id);else scheduler.reset(entry.id);}
  if(['up','down'].includes(req.body.move)) {
    const ordered=[...sources].sort((a,b)=>a.priority-b.priority),index=ordered.indexOf(entry),target=index+(req.body.move==='up'?-1:1);
    if(target>=0&&target<ordered.length){[ordered[index],ordered[target]]=[ordered[target],ordered[index]];ordered.forEach((item,index)=>item.priority=index);}
  }
  await saveSources();res.json(entry);
});
onlineRouter.delete('/sources/:id',async(req,res)=>{const entry=sources.find(item=>item.id===req.params.id);if(!entry)return res.sendStatus(404);await removeSource(entry);res.json({ok:true});});
onlineRouter.post('/sources/:id/check',async(req,res)=>{const entry=sources.find(item=>item.id===req.params.id);if(!entry)return res.sendStatus(404);await checkSource(entry);scheduler.reset(entry.id);res.json({ok:true,entry});});
onlineRouter.get('/catalog/albums',async(req,res)=>{
  const keyword=String(req.query.q||'').trim(),platform=String(req.query.platform||'wy');
  const page=Number(req.query.page||1);
  if(!keyword||keyword.length>100||!(platform==='all'||albumPlatforms.has(platform))||!Number.isSafeInteger(page)||page<1)
    return res.status(400).json({error:'无效的专辑搜索参数'});
  const controller=new AbortController();res.once('close',()=>controller.abort());
  res.json(await searchAlbums(keyword,platform,page,controller.signal));
});
onlineRouter.get('/catalog/albums/:platform/tracks',async(req,res)=>{
  const {platform}=req.params,id=String(req.query.id||'');
  if(!validAlbumId(platform,id))
    return res.status(400).json({error:'无效的专辑'});
  const controller=new AbortController();res.once('close',()=>controller.abort());
  res.json({tracks:await albumTracks(platform,id,controller.signal,String(req.query.name||"").slice(0,250),String(req.query.artist||"").slice(0,250))});
});
onlineRouter.get('/catalog/track-album/:id',async(req,res)=>{
  const id=req.params.id;
  const controller=new AbortController();res.once('close',()=>controller.abort());
  const local=state.tracks.find(track=>track.id===id);
  const online=local?undefined:getOnlineTrack(id);
  const track=local??online!;
  const platform=online?.platform??'local';
  const albumId=online?String(online.musicInfo.albumMid||online.musicInfo.albumId||''):JSON.stringify([track.album,track.artist]);
  if(!track.album.trim()||track.album==='未知专辑'||!validAlbumId(platform,albumId)||(online&&/^0+$/.test(albumId)))
    return res.status(404).json({error:'这首歌没有可用的专辑信息'});
  const tracks=await albumTracks(platform,albumId,controller.signal,track.album,track.artist);
  res.json({name:track.album,tracks});
});
onlineRouter.get('/catalog/hot-search', async (_req, res) => {
  res.json({ keywords: await qqHotSearch() });
});
onlineRouter.get('/catalog/search',async(req,res)=>{
  const keyword=String(req.query.q||'').trim();if(!keyword||keyword.length>100)return res.status(400).json({error:'请输入 1–100 字的关键词'});
  const page=Math.max(1,Math.floor(Number(req.query.page)||1));
  const controller=new AbortController();res.once('close',()=>controller.abort());
  res.json(await searchCatalog(keyword,String(req.query.platform||'all'),page,controller.signal,[50,100,200].includes(Number(req.query.pageSize))?Number(req.query.pageSize):50,req.query.onlineOnly==='1'));
});
export function matchesLocalTrack(local: Pick<StoredTrack, 'title' | 'artist' | 'duration'>, track: OnlineTrack) {
  const normalize = (value: string) => value.toLowerCase().replace(/[\s、,，&]/g, '');
  return normalize(local.title) === normalize(track.title) &&
    normalize(local.artist) === normalize(track.artist) &&
    (!local.duration || !track.duration || Math.abs(local.duration - track.duration) < 4);
}

export async function hasLocalCopy(track: OnlineTrack) {
  for (const local of state.tracks) {
    if (!local.available || (local.id !== bindings[track.id] && !matchesLocalTrack(local, track))) continue;
    try { await authorizedFile(local); return true; } catch { /* Ignore missing or inaccessible files. */ }
  }
  return false;
}

function localQuality(track: StoredTrack) {
  if (track.audioVariants?.some(variant => variant.quality === 'flac24bit')) return 2;
  return ['FLAC', 'WAV'].includes(track.format.toUpperCase()) ? 1 : 0;
}

function localBitrate(track: StoredTrack) {
  const bitrate = Math.max(0, ...(track.audioVariants ?? []).map(variant => variant.bitrate ?? 0));
  return bitrate || (track.duration > 0 ? track.size * 8 / track.duration / 1000 : 0);
}

onlineRouter.get('/online/:id/candidates',(req,res)=>{
  const track=getOnlineTrack(req.params.id);
  const candidates=state.tracks.filter(local=>local.available && matchesLocalTrack(local,track));
  res.json({bound:bindings[track.id]||null,tracks:candidates.map(publicTrack)});
});
onlineRouter.post('/online/:id/binding',async(req,res)=>{
  const track=getOnlineTrack(req.params.id);const local=state.tracks.find(item=>item.id===req.body.localTrackId);if(!local)return res.status(404).json({error:'本地歌曲不存在'});
  await authorizedFile(local);await bindOnlineLocal(track,local.id);
  res.json({ok:true});
});
onlineRouter.post('/online/:id/resolve',async(req,res)=>{
  const track=getOnlineTrack(req.params.id);await saveOnlineTrack(track);
  const quality=String(req.body.quality||sourceSettings.quality);if(!qualityOrder.includes(quality))throw new Error('无效音质');
  if (req.body.skipLocal === true)
    recordPlaybackOutcome(track, req.body.activityId, 'source-failed');
  const activity = sourceActivity('playback', track, quality, req.body.activityId);
  if (req.body.skipLocal !== true && req.body.onlineOnly !== true) {
    const boundId = bindings[track.id];
    const candidates = state.tracks
      .filter(local => local.available && (local.id === boundId || matchesLocalTrack(local, track)))
      .sort((a, b) => localQuality(b) - localQuality(a) ||
        localBitrate(b) - localBitrate(a) ||
        Number(b.id === boundId) - Number(a.id === boundId));
    for (const local of candidates) {
      try {
        await authorizedFile(local);
      } catch {
        continue;
      }
      activity.record('resolved', { source: '本地文件', quality: local.format });
      return res.json({
        mode: 'local',
        activityId: activity.id,
        audioUrl: `/api/tracks/${local.id}/audio`,
        lyricUrl: `/api/tracks/${local.id}/lyrics`,
        quality: local.format,
        audioVariant: local.audioVariants?.at(-1),
        sourceName: '本地文件',
      });
    }
  }
  const excluded=Array.isArray(req.body.exclude)?req.body.exclude.filter((value:unknown)=>typeof value==='string').slice(0,20):[];
  const controller=new AbortController();res.once('close',()=>controller.abort());
  const result = await resolveOnlineAudio(track, quality, excluded, controller.signal, undefined, activity).catch(error => {
    activity.record(controller.signal.aborted ? 'cancelled' : 'failed');
    throw error;
  });
  for(const [id,lease]of leases)if(lease.expires<Date.now())leases.delete(id);
  if(leases.size>=500)leases.delete(leases.keys().next().value!);
  const id=randomUUID();leases.set(id,{trackId:track.id,url:result.url,sourceId:result.sourceId,expires:Date.now()+30*60000});
  res.json({mode:'online',audioUrl:`/api/online/${encodeURIComponent(track.id)}/audio?lease=${id}`,lyricUrl:`/api/online/${encodeURIComponent(track.id)}/lyrics`,quality:result.quality,sourceId:result.sourceId,sourceName:result.sourceName,activityId:activity.id});
});
onlineRouter.get('/online/:id/audio',async(req,res,next)=>{
  const lease=leases.get(String(req.query.lease||''));if(!lease||lease.trackId!==req.params.id||lease.expires<Date.now())return res.status(410).json({error:'播放链接已过期，请重新播放'});
  const controller=new AbortController();res.once('close',()=>controller.abort());
  const headers:Record<string,string>={};if(req.headers.range)headers.Range=req.headers.range;
  const upstream=await openPublicUrl(lease.url,{headers,signal:controller.signal});
  if(![200,206,416].includes(upstream.statusCode||0)){upstream.destroy();return res.status(502).json({error:'音源文件无法读取'});}
  if(/text\/|json|xml/i.test(upstream.headers['content-type']||'')){upstream.destroy();return res.status(502).json({error:'音源返回了非音频内容'});}
  for(const key of ['content-type','content-length','content-range','accept-ranges'])if(upstream.headers[key])res.setHeader(key,upstream.headers[key]!);
  res.setHeader('Cache-Control','private, no-store');res.status(upstream.statusCode!);upstream.on('error',error=>{if(res.headersSent)res.destroy();else next(error);});upstream.pipe(res);
});
onlineRouter.get('/online/:id/details',async(req,res)=>{
  const track=await enrichOnlineTrack(getOnlineTrack(req.params.id));
  const local=state.tracks.find(item=>item.id===bindings[track.id]);
  res.json({...publicOnlineTrack(track),...(local?{fileLocation:local.path}:{})});
});
onlineRouter.get('/online/:id/cover',async(req,res)=>{
  try {const cover=await getOnlineCover(req.params.id);res.setHeader('Content-Type',cover.type);res.setHeader('Cache-Control','private, max-age=3600');res.send(cover.bytes);}
  catch {res.sendStatus(404);}
});
onlineRouter.get('/online/:id/lyrics',async(req,res)=>{
  const controller=new AbortController();res.once('close',()=>controller.abort());
  try{res.json({text:await getOnlineLyrics(getOnlineTrack(req.params.id),controller.signal)});}catch{if(!res.destroyed)res.json({text:''});}
});

export async function bindOnlineLocal(track:OnlineTrack,localId:string) {
  bindings[track.id]=localId;await saveOnlineTrack(track);
  saveBinding(track.id,localId);
}

export { onlineTracks, publicOnlineTrack, getOnlineTrack, saveOnlineTrack };
