import { Buffer } from 'node:buffer';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { loadRecords, upsertRecord, searchLocalRecords } from '../../db/database.js';
import { publicTrack, type StoredTrack } from '../../db/store.js';
import { requestPublic } from '../sources/network.js';
import { platforms } from '../sources/protocol.js';
import type { Track, AudioVariant } from '../../contracts.js';

export interface OnlineTrack extends Track { platform:string; songId:string; musicInfo:Record<string,unknown>; image?:string; lyricUrl?:string }
export const onlineTracks:Record<string,OnlineTrack>=Object.fromEntries(loadRecords<OnlineTrack>('online_tracks').map(track=>[track.id,track]));
const searchCache=new Map<string,OnlineTrack>();
export async function saveOnlineTrack(track:OnlineTrack){onlineTracks[track.id]=track;upsertRecord('online_tracks',track);}
export function getOnlineTrack(id:string){const track=searchCache.get(id)||onlineTracks[id];if(!track)throw new Error('歌曲已过期，请重新搜索');return track;}
export function publicOnlineTrack({musicInfo:_info,image:_image,lyricUrl:_lyric,songId:_songId,...track}:OnlineTrack){
  const variants=track.audioVariants||audioVariants(_info.types);
  return {...track,image:_image,audioVariants:variants,hasCover:true,format:variants.at(-1)?.format||'未知',size:variants.at(-1)?.size||0};
}
function audioVariants(input:unknown):AudioVariant[] {
  if(!Array.isArray(input))return [];
  const order=['128k','320k','flac','flac24bit'];
  return [...input].sort((a,b)=>order.indexOf(a.type)-order.indexOf(b.type)).map(item=>{
    const quality=String(item.type);const raw=item.size;
    let size=typeof raw==='number'&&raw>0?raw:undefined;
    if(typeof raw==='string'){
      const match=/^([\d.]+)\s*([KMGT]?)(?:I?B)?$/i.exec(raw.trim());
      if(match){const value=Number(match[1])*1024**Math.max(0,' KMGT'.indexOf(match[2].toUpperCase()));if(Number.isFinite(value)&&value>0)size=Math.round(value);}
    }
    return {quality,format:String(item.format||(['flac','flac24bit'].includes(quality)?'FLAC':['128k','320k'].includes(quality)?'MP3':'未知')).toUpperCase(),size,sizeText:typeof raw==='string'?raw:undefined,bitrate:quality==='128k'?128:quality==='320k'?320:undefined};
  });
}
const md5=(value:string)=>createHash('md5').update(value).digest('hex');
const text=(value:unknown)=>String(value??'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
const interval=(duration:number)=>`${Math.floor(duration/60)}:${String(Math.floor(duration%60)).padStart(2,'0')}`;
export function song(platform:string, id:unknown, title:unknown, artist:unknown, album:unknown, duration:unknown, info:Record<string,any>, image?:string, lyricUrl?:string):OnlineTrack {
  const seconds=Math.max(0,Number(duration)||0);
  const variants=audioVariants(info.types);
  return {id:`online:${platform}:${String(id)}`,directoryId:'',title:text(title),artist:text(artist)||'未知歌手',album:text(album)||'未知专辑',duration:seconds,format:variants.at(-1)?.format||'未知',size:variants.at(-1)?.size||0,modified:0,hasCover:true,hasLyrics:true,available:true,online:true,platform,songId:String(id),image,lyricUrl,audioVariants:variants,qualities:(info.types||[]).map((type:{type:string})=>type.type),musicInfo:{...info,name:text(title),singer:text(artist),albumName:text(album),source:platform,interval:interval(seconds),songmid:info.songmid??id,img:image,lrc:null,typeUrl:{}}};
}
export function types(values:Record<string,unknown>){return Object.entries(values).filter(([,size])=>Number(size)>0).map(([type,size])=>({type,size}));}
export async function eapi(endpoint:string, data:unknown, signal:AbortSignal) {
  const value=JSON.stringify(data);const digest=md5(`nobody${endpoint}use${value}md5forencrypt`);
  const cipher=createCipheriv('aes-128-ecb',Buffer.from('e82ckenh8dichen8'),null);
  const encrypted=Buffer.concat([cipher.update(`${endpoint}-36cd479b6b5-${value}-36cd479b6b5-${digest}`),cipher.final()]).toString('hex').toUpperCase();
  const response=await requestPublic('https://interface.music.163.com/eapi/batch',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',origin:'https://music.163.com'},body:new URLSearchParams({params:encrypted}).toString(),signal});
  return response.body as any;
}
function applyWyMetadata(track:OnlineTrack,item:any) {
  if(item.al?.picUrl){track.image=item.al.picUrl;track.musicInfo.img=track.image;}
  const quality=types({'128k':item.l?.size,'320k':item.h?.size,flac:item.sq?.size,flac24bit:item.hr?.size});
  if(quality.length){track.musicInfo.types=quality;track.musicInfo._types=Object.fromEntries(quality.map(type=>[type.type,type]));track.audioVariants=audioVariants(quality);track.qualities=quality.map(type=>type.type);}
  return track;
}
export async function enrichOnlineTrack(track:OnlineTrack,signal=AbortSignal.timeout(10000)) {
  if(track.platform==='wy'&&(!track.image||!track.audioVariants?.length)){
    try{const result=await eapi('/api/v3/song/detail',{c:JSON.stringify([{id:track.songId}]),ids:JSON.stringify([track.songId])},signal);const item=result?.songs?.[0];if(item)applyWyMetadata(track,item);}catch{/* Keep known metadata if detail lookup fails. */}
  }
  return track;
}
export async function requestQqCatalog(payload:Record<string,unknown>,signal:AbortSignal){
    const body=JSON.stringify(payload),hash=createHash('sha1').update(body).digest('hex');
    const pick=(indexes:number[])=>indexes.map(i=>hash[i]).join('');
    const scramble=[89,39,179,150,218,82,58,252,177,52,186,123,120,64,242,133,143,161,121,179];
    const signature=('zzc'+pick([23,14,6,36,16,40,7,19])+Buffer.from(scramble.map((v,i)=>v^parseInt(hash.slice(i*2,i*2+2),16))).toString('base64').replace(/[\\/+=]/g,'')+pick([16,1,32,12,19,27,8,5])).toLowerCase();
    return (await requestPublic(`https://u.y.qq.com/cgi-bin/musics.fcg?sign=${signature}`,{method:'POST',body,headers:{'content-type':'application/json','user-agent':'QQMusic 14090508(android 12)'},signal})).body as any;
}
export async function searchPlatform(platform:string,keyword:string,page:number,signal:AbortSignal):Promise<{total:number;tracks:OnlineTrack[]}> {
  const q=encodeURIComponent(keyword),limit=30;
  if(platform==='wy') {
    const response=await eapi('/api/search/song/list/page',{keyword,needCorrect:'1',channel:'typing',offset:(page-1)*limit,scene:'normal',total:page===1,limit},signal);
    if(response.code!==200||!response.data)throw new Error('网易搜索暂不可用');
    return {total:Number(response.data.totalCount)||0,tracks:(response.data.resources||[]).map((resource:any)=>{
      const item=resource.baseInfo.simpleSongData;const quality=types({'128k':item.l?.size,'320k':item.h?.size,flac:item.sq?.size,flac24bit:item.hr?.size});
      return song('wy',item.id,item.name,item.ar?.map((a:any)=>a.name).join('、'),item.al?.name,item.dt/1000,{songmid:item.id,albumId:item.al?.id,types:quality,_types:Object.fromEntries(quality.map(t=>[t.type,t]))},item.al?.picUrl);
    })};
  }
  if(platform==='tx') {
    const payload={comm:{ct:'19',cv:'2151',uin:'0'},'music.search.SearchCgiService':{module:'music.search.SearchCgiService',method:'DoSearchForQQMusicDesktop',param:{grp:1,num_per_page:limit,page_num:page,query:keyword,remoteplace:'txt.newclient.top',search_type:0,searchid:randomBytes(16).toString('hex').toUpperCase()+'00001'}}};
    const response=await requestQqCatalog(payload,signal);
    const result=response?.['music.search.SearchCgiService'];if(response?.code!==0||result?.code!==0)throw new Error('QQ 搜索暂不可用');
    return {total:Number(result.data.meta?.sum)||0,tracks:(result.data.body?.song?.list||[]).map((item:any)=>{
      const quality=types({'128k':item.file?.size_128mp3,'320k':item.file?.size_320mp3,flac:item.file?.size_flac,flac24bit:item.file?.size_hires});
      return song('tx',item.mid,item.title||item.name,item.singer?.map((s:any)=>s.name).join('、'),item.album?.name,item.interval,{songmid:item.mid,songId:item.id,albumId:item.album?.mid,albumMid:item.album?.mid,strMediaMid:item.file?.media_mid,types:quality,_types:Object.fromEntries(quality.map(t=>[t.type,t]))},item.album?.mid?`https://y.gtimg.cn/music/photo_new/T002R500x500M000${item.album.mid}.jpg`:undefined);
    })};
  }
  if(platform==='kw') {
    const result=(await requestPublic(`http://search.kuwo.cn/r.s?client=kt&all=${q}&pn=${page-1}&rn=${limit}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`,{signal})).body as any;
    if(!result||!Array.isArray(result.abslist))throw new Error('酷我搜索暂不可用');
    return {total:Number(result.TOTAL)||0,tracks:result.abslist.map((item:any)=>{
      const quality=[...String(item.N_MINFO||'').matchAll(/bitrate:(\d+),format:\w+,size:([\w.]+)/g)].map(m=>({type:({'128':'128k','320':'320k','2000':'flac','4000':'flac24bit'} as Record<string,string>)[m[1]],size:m[2]})).filter(t=>t.type);
      const id=String(item.MUSICRID).replace('MUSIC_','');return song('kw',id,item.SONGNAME,item.ARTIST,item.ALBUM,item.DURATION,{songmid:id,albumId:item.ALBUMID,types:quality,_types:Object.fromEntries(quality.map(t=>[t.type,t]))},item.pic||item.PIC);
    })};
  }
  if(platform==='kg') {
    const result=(await requestPublic(`http://songsearch.kugou.com/song_search_v2?platform=AndroidFilter&iscorrection=1&keyword=${q}&hifiquality=0&pagesize=${limit}&PrivilegeFilter=0&page=${page}`,{signal})).body as any;
    if(result?.error_code!==0||!result.data)throw new Error('酷狗搜索暂不可用');
    return {total:Number(result.data.total)||0,tracks:(result.data.lists||[]).map((item:any)=>{
      const quality=[['128k','FileSize','FileHash'],['320k','HQFileSize','HQFileHash'],['flac','SQFileSize','SQFileHash'],['flac24bit','ResFileSize','ResFileHash']].filter(([,size])=>Number(item[size])>0).map(([type,size,hash])=>({type,size:item[size],hash:item[hash]}));
      return song('kg',item.Audioid,item.OriSongName||item.SongName,item.Singers?.map((s:any)=>s.name).join('、')||item.SingerName,item.AlbumName,item.Duration,{songmid:item.Audioid,albumId:item.AlbumID,albumAudioId:item.MixSongID,hash:item.FileHash,types:quality,_types:Object.fromEntries(quality.map(t=>[t.type,t]))},item.Image?.replace('{size}','400'));
    })};
  }
  const timestamp=String(Date.now()),device='963B7AA0D21511ED807EE5846EC87D20';
  const sign=md5(keyword+'6cdc72a439cef99a3418d2a78aa28c73'+'yyapp2d16148780a1dcc7408e06336b98cfd50'+device+timestamp);
  const result=(await requestPublic(`https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=${encodeURIComponent(JSON.stringify({song:1,album:0,singer:0,tagSong:1,mvSong:0,bestShow:1,songlist:0,lyricSong:0}))}&pageSize=${limit}&text=${q}&pageNo=${page}&sort=0&sid=USS`,{signal,headers:{uiVersion:'A_music_3.6.1',deviceId:device,timestamp,sign,channel:'0146921'}})).body as any;
  if(result?.code!=='000000')throw new Error('咪咕搜索暂不可用');
  return {total:Number(result.songResultData?.totalCount)||0,tracks:(result.songResultData?.resultList||[]).flat().filter((item:any)=>item.songId&&item.copyrightId).map((item:any)=>{
    const quality=(item.audioFormats||[]).map((t:any)=>({type:({PQ:'128k',HQ:'320k',SQ:'flac',ZQ24:'flac24bit'} as Record<string,string>)[t.formatType],size:t.asize??t.isize})).filter((t:any)=>t.type);
    let image=item.img3||item.img2||item.img1;if(image&&!/^https?:/.test(image))image='https://d.musicapp.migu.cn'+image;
    return song('mg',item.songId,item.name,item.singerList?.map((s:any)=>s.name).join('、'),item.album,item.duration,{songmid:item.songId,copyrightId:item.copyrightId,albumId:item.albumId,types:quality,_types:Object.fromEntries(quality.map((t:any)=>[t.type,t]))},image,item.lrcUrl);
  })};
}
async function searchBatch(keyword:string,platform:string,page:number,signal?:AbortSignal) {
  const localTracks=searchLocalRecords<StoredTrack>(keyword).map(publicTrack);
  if(platform==='local')return {tracks:localTracks,platforms:[],page,localCount:localTracks.length};
  const selected=platform==='all'?[...platforms]:platforms.filter(p=>p===platform);
  if(!selected.length)throw new Error('不支持的平台');
  const settled=await Promise.all(selected.map(async platform=>{
    try {const result=await searchPlatform(platform,keyword,page,signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000));return {platform,...result,error:null};}
    catch {return {platform,tracks:[] as OnlineTrack[],total:0,error:'该平台搜索失败，请重试'};}
  }));
  const wyTracks:OnlineTrack[]=settled.find(result=>result.platform==='wy')?.tracks||[];
  if(wyTracks.some(track=>!track.image||!track.audioVariants?.length)){
    try{const ids=wyTracks.map(track=>track.songId),timeout=signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000);
      const result=await eapi('/api/v3/song/detail',{c:JSON.stringify(ids.map(id=>({id}))),ids:JSON.stringify(ids)},timeout);
      const details=new Map((result.songs||[]).map((item:any)=>[String(item.id),item]));for(const track of wyTracks){const item=details.get(track.songId);if(item)applyWyMetadata(track,item);}
    }catch{/* Search still succeeds when optional metadata lookup fails. */}
  }
  for(const result of settled)for(const track of result.tracks)searchCache.set(track.id,track);
  while(searchCache.size>3000)searchCache.delete(searchCache.keys().next().value!);
  return {tracks:[...localTracks,...settled.flatMap(item=>item.tracks).map(publicOnlineTrack)],localCount:localTracks.length,platforms:settled.map(({tracks:_tracks,...result})=>result),page};
}

export async function searchCatalog(keyword:string,platform:string,page:number,signal?:AbortSignal,pageSize=50,onlineOnly=false){
  const local=onlineOnly ? [] : searchLocalRecords<StoredTrack>(keyword).map(publicTrack),start=(page-1)*pageSize,end=start+pageSize;
  if(platform==='local')return {tracks:local.slice(start,end),localCount:local.length,total:local.length,platforms:[],page,pageSize};
  const first=await searchBatch(keyword,platform,1,signal);
  const counts=first.platforms.map(item=>Math.max(0,Math.floor(item.total))),total=local.length+counts.reduce((sum,n)=>sum+n,0);
  const tracks:Track[]=local.slice(start,end);
  const windows:{batch:number;platform:string;start:number;end:number}[]=[];
  let cursor=local.length;
  for(let batch=1;batch<=Math.ceil(Math.max(0,...counts)/30)&&cursor<end;batch++){
    for(let i=0;i<counts.length;i++){
      const count=Math.max(0,Math.min(30,counts[i]-(batch-1)*30)),next=cursor+count;
      if(next>start&&cursor<end&&count)windows.push({batch,platform:first.platforms[i].platform,start:Math.max(0,start-cursor),end:Math.min(count,end-cursor)});
      cursor=next;
    }
  }
  const batches=new Map<number,Awaited<ReturnType<typeof searchBatch>>>([[1,first]]);
  await Promise.all([...new Set(windows.map(w=>w.batch))].filter(batch=>batch!==1).map(async batch=>batches.set(batch,await searchBatch(keyword,platform,batch,signal))));
  for(const window of windows)tracks.push(...batches.get(window.batch)!.tracks.filter(track=>track.online&&track.platform===window.platform).slice(window.start,window.end));
  return {tracks,localCount:local.length,total,platforms:first.platforms,page,pageSize};
}

export function cacheCatalogTracks(tracks:OnlineTrack[]) {
  for(const track of tracks)searchCache.set(track.id,track);
  while(searchCache.size>3000)searchCache.delete(searchCache.keys().next().value!);
}
