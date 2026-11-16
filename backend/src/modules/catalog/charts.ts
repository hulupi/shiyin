import { Router } from 'express';
import { requestPublic } from '../sources/network.js';
import { cacheCatalogTracks, publicOnlineTrack, song, types, type OnlineTrack } from './service.js';

export interface Chart { id:string; name:string; image:string; description:string; update:string; count:number; group:string }
const platforms = new Set(['wy','tx','kw','kg','mg']);
export function createCatalogCache(ttlMs: number, maxEntries = 100) {
  const cache = new Map<string, { expires: number; value: unknown }>();
  const pending = new Map<string, Promise<unknown>>();

  return async function cached<T>(key: string, refresh: boolean, fetcher: () => Promise<T>): Promise<T> {
    const saved = cache.get(key);
    if (!refresh && saved && saved.expires > Date.now()) return saved.value as T;
    const inFlight = pending.get(key);
    if (inFlight) return inFlight as Promise<T>;

    const request = fetcher().then(value => {
      cache.set(key, { expires: Date.now() + ttlMs, value });
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };
}

export const cached = createCatalogCache(5 * 60 * 1000);

async function json(url:string) {
  const result=await requestPublic(url,{signal:AbortSignal.timeout(15000)});
  if(result.statusCode!==200||typeof result.body!=='object'||!result.body)throw new Error('榜单服务暂不可用，请稍后重试');
  return result.body as any;
}
async function qq(method:string,param:Record<string,unknown>) {
  const result=await json('https://u.y.qq.com/cgi-bin/musicu.fcg?data='+encodeURIComponent(JSON.stringify({req_0:{module:'musicToplist.ToplistInfoServer',method,param}})));
  if(result.code!==0||result.req_0?.code!==0)throw new Error('QQ 音乐榜单暂不可用');
  return result.req_0.data;
}
const clean=(value:unknown)=>String(value??'').replace(/<br\s*\/?>/gi,' ').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&');
const image=(value:unknown)=>String(value||'').replaceAll('{size}','240').replace(/^http:/,'https:');
export async function listCharts(platform:string,refresh=false):Promise<Chart[]> {
  if(!platforms.has(platform))throw new Error('不支持的榜单平台');
  return cached('list:'+platform,refresh,async()=>{
    if(platform==='wy') {
      const data=await json('https://music.163.com/api/toplist');
      if(data.code!==200||!Array.isArray(data.list))throw new Error('网易云榜单暂不可用');
      return data.list.map((item:any)=>({id:String(item.id),name:clean(item.name),image:image(item.coverImgUrl),description:clean(item.description),update:clean(item.updateFrequency)||'定期更新',count:Number(item.trackCount)||0,group:'排行榜'}));
    }
    if(platform==='tx') {
      const data=await qq('GetAll',{});
      if(!Array.isArray(data.group))throw new Error('QQ 音乐榜单暂不可用');
      return data.group.flatMap((group:any)=>(group.toplist||[]).map((item:any)=>({id:String(item.topId),name:clean(item.title),image:image(item.frontPicUrl||item.headPicUrl||item.song?.[0]?.cover),description:clean(item.intro),update:clean(item.updateTime),count:Number(item.totalNum)||0,group:clean(group.groupName)})));
    }
    if(platform==='kw') {
      const data=await json('http://qukudata.kuwo.cn/q.k?op=query&cont=tree&node=2&pn=0&rn=1000&fmt=json&level=2');
      if(!Array.isArray(data.child))throw new Error('酷我榜单暂不可用');
      const result:Chart[]=[],seen=new Set<string>();
      function collect(items:any[],group='排行榜') {
        for(const item of items){
          const id=String(item.sourceid||'');
          if(String(item.source)==='1'&&/^\d+$/.test(id)&&!seen.has(id)) {
            seen.add(id);result.push({id,name:clean(item.name),image:image(item.pic),description:clean(item.tips),update:'定期更新',count:0,group});
          }
          if(Array.isArray(item.child))collect(item.child,String(item.source)==='1'?group:clean(item.name)||group);
        }
      }
      collect(data.child);
      const priority=['93','16','17'];
      return result.sort((a,b)=>(priority.includes(a.id)?priority.indexOf(a.id):priority.length)-(priority.includes(b.id)?priority.indexOf(b.id):-1+priority.length+1));
    }
    if(platform==='mg') {
      const data=await json('https://app.c.nf.migu.cn/pc/bmw/rank/rank-index/v1.0');
      if(data.code!=='000000'||!Array.isArray(data.data?.contents))throw new Error('咪咕榜单暂不可用');
      const result:Chart[]=[],seen=new Set<string>();
      function collect(items:any[],group='排行榜') {
        for(const item of items){
          const id=String(item.rankId||'');
          if(/^\d+$/.test(id)&&item.rankName&&!seen.has(id)) {
            seen.add(id);result.push({id,name:clean(item.rankName),image:image(item.imageUrl),description:clean(item.rankDesc),update:'定期更新',count:0,group});
          }
          if(Array.isArray(item.contents))collect(item.contents,clean(item.style)||group);
        }
      }
      collect(data.data.contents);return result;
    }
    const data=await json('https://m.kugou.com/rank/list?json=true');
    if(!Array.isArray(data.rank?.list))throw new Error('酷狗榜单暂不可用');
    return data.rank.list.filter((item:any)=>!item.haschildren).map((item:any)=>({id:String(item.rankid),name:clean(item.rankname),image:image(item.imgurl||item.img_9||item.banner_9),description:clean(item.intro),update:clean(item.update_frequency)||'定期更新',count:Number(item.songcount)||0,group:'排行榜'}));
  });
}
export async function chartTracks(platform:string,id:string,page=1,refresh=false) {
  const charts=await listCharts(platform);
  const chart=charts.find(item=>item.id===id);
  if(!chart)throw new Error('榜单不存在，请刷新列表');
  const result=await cached(`detail:${platform}:${id}:${page}`,refresh,async()=>{
    let tracks:OnlineTrack[]=[],total=0,hasMore=false;
    if(platform==='wy') {
      const data=await cached('wy-playlist:'+id,refresh,()=>json(`https://music.163.com/api/v6/playlist/detail?id=${id}&n=1000&s=0`));
      if(data.code!==200||!Array.isArray(data.playlist?.tracks))throw new Error('榜单歌曲暂不可用');
      const items=data.playlist.tracks;total=items.length;
      tracks=items.slice((page-1)*50,page*50).map((item:any)=>{
        const quality=types({'128k':item.l?.size,'320k':item.h?.size,flac:item.sq?.size,flac24bit:item.hr?.size});
        return song('wy',item.id,item.name,item.ar?.map((a:any)=>a.name).join('、'),item.al?.name,item.dt/1000,{songmid:item.id,albumId:item.al?.id,types:quality,_types:Object.fromEntries(quality.map(t=>[t.type,t]))},image(item.al?.picUrl));
      });hasMore=page*50<total;
    } else if(platform==='tx') {
      const data=await qq('GetDetail',{topid:Number(id),num:50,offset:(page-1)*50});
      if(!Array.isArray(data.songInfoList))throw new Error('榜单歌曲暂不可用');
      total=Number(data.data?.totalNum)||0;
      tracks=data.songInfoList.map((item:any)=>{
        const quality=types({'128k':item.file?.size_128mp3,'320k':item.file?.size_320mp3,flac:item.file?.size_flac,flac24bit:item.file?.size_hires});
        return song('tx',item.mid,item.title||item.name,item.singer?.map((a:any)=>a.name).join('、'),item.album?.name,item.interval,{songmid:item.mid,songId:item.id,albumId:item.album?.mid,albumMid:item.album?.mid,strMediaMid:item.file?.media_mid,types:quality,_types:Object.fromEntries(quality.map(t=>[t.type,t]))},item.album?.mid?`https://y.gtimg.cn/music/photo_new/T002R500x500M000${item.album.pmid||item.album.mid}.jpg`:undefined);
      });hasMore=tracks.length>0&&page*50<total;
    } else if(platform==='kw') {
      const data=await json(`http://kbangserver.kuwo.cn/ksong.s?from=pc&fmt=json&pn=${page-1}&rn=50&type=bang&data=content&id=${id}&show_copyright_off=0&pcmp4=1&isbang=1`);
      if(!Array.isArray(data.musiclist))throw new Error('酷我榜单歌曲暂不可用');
      total=Number(data.num)||0;
      tracks=data.musiclist.map((item:any)=>{
        const formats=new Set(String(item.formats||'').split('|'));
        const quality=[['128k','MP3128'],['320k','MP3H'],['flac','ALFLAC']].filter(([,format])=>formats.has(format)).map(([type])=>({type}));
        return song('kw',item.id,item.name,item.artist,item.album,item.song_duration,{songmid:item.id,albumId:item.albumid,types:quality,_types:Object.fromEntries(quality.map(t=>[t.type,t]))},image(item.pic)||undefined);
      });hasMore=tracks.length>0&&page*50<total;
    } else if(platform==='mg') {
      const data=await cached('mg-column:'+id,refresh,()=>json(`https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/querycontentbyId.do?columnId=${id}&needAll=0`));
      if(data.code!=='000000'||!Array.isArray(data.columnInfo?.contents))throw new Error('咪咕榜单歌曲暂不可用');
      const items=data.columnInfo.contents.map((entry:any)=>entry.objectInfo).filter((item:any)=>item?.songId&&item.copyrightId);
      total=items.length;
      tracks=items.slice((page-1)*50,page*50).map((item:any)=>{
        const quality=(item.newRateFormats||item.rateFormats||[]).map((entry:any)=>({type:({PQ:'128k',HQ:'320k',SQ:'flac',ZQ24:'flac24bit',ZQ:'flac24bit'} as Record<string,string>)[entry.formatType],size:entry.androidSize||entry.size})).filter((entry:any)=>entry.type);
        const duration=String(item.length||'0').split(':').reduce((sum:number,part:string)=>sum*60+(Number(part)||0),0);
        return song('mg',item.songId,item.songName,item.singer,item.album,duration,{songmid:item.songId,copyrightId:item.copyrightId,albumId:item.albumId,types:quality,_types:Object.fromEntries(quality.map((t:any)=>[t.type,t]))},image(item.albumImgs?.[0]?.img),item.lrcUrl);
      });hasMore=page*50<total;
    } else {
      const data=await json(`https://m.kugou.com/rank/info/?rankid=${id}&page=${page}&json=true`);
      if(!Array.isArray(data.songs?.list))throw new Error('榜单歌曲暂不可用');
      total=Number(data.songs.total)||0;
      tracks=data.songs.list.map((item:any)=>{
        const quality=[['128k','filesize','hash'],['320k','320filesize','320hash'],['flac','sqfilesize','sqhash'],['flac24bit','filesize_high','hash_high']].filter(([,size])=>Number(item[size])>0).map(([type,size,hash])=>({type,size:item[size],hash:item[hash]}));
        const songId=item.audio_id||item.album_audio_id||item.hash;
        return song('kg',songId,item.songname||item.filename?.split(' - ').slice(1).join(' - '),item.authors?.map((a:any)=>a.author_name).join('、')||item.filename?.split(' - ')[0],item.album_name||'',item.duration,{songmid:songId,albumId:item.album_id,albumAudioId:item.album_audio_id,hash:item.hash,types:quality,_types:Object.fromEntries(quality.map(t=>[t.type,t]))},image(item.album_sizable_cover));
      });hasMore=tracks.length>0&&page*(Number(data.pagesize)||30)<total;
    }
    return {chart,tracks,total,hasMore,page};
  });
  cacheCatalogTracks(result.tracks);
  return {...result,tracks:result.tracks.map(publicOnlineTrack)};
}
