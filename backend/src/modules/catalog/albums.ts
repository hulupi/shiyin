import { createHash, randomBytes } from 'node:crypto';
import { convertCatalogTrack, parseKuwoSearch } from './discover.js';
import type { AlbumSearchResult } from '../../contracts.js';
import { searchLocalRecords } from '../../db/database.js';
import { state, publicTrack, type StoredTrack } from '../../db/store.js';
import { requestPublic } from '../sources/network.js';
import { cacheCatalogTracks, publicOnlineTrack, requestQqCatalog } from './service.js';

const pageSize=24;

function localAlbums(keyword:string) {
  const albums=new Map<string,AlbumSearchResult>();
  for(const track of searchLocalRecords<StoredTrack>(keyword,true)){
    if(!track.album.trim()||track.album==='未知专辑')continue;
    const id=JSON.stringify([track.album,track.artist]);
    if(!albums.has(id))albums.set(id,{id,platform:'local',name:track.album,artist:track.artist,coverTrackId:track.hasCover?track.id:undefined});
    else if(track.hasCover)albums.get(id)!.coverTrackId??=track.id;
  }
  return [...albums.values()];
}

async function netease(path:string,signal:AbortSignal){
  const response=await requestPublic('https://music.163.com'+path,{signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
  const data=response.body as any;
  if(response.statusCode!==200||data?.code!==200)throw new Error('网易云专辑服务暂不可用');
  return data;
}


export const albumPlatforms=new Set(['local','wy','tx','kw','kg','mg']);
export function validAlbumId(platform:string,id:string){
  return albumPlatforms.has(platform)&&id.length>0&&(platform==='local'?id.length<=1000:platform==='tx'?/^[a-zA-Z0-9]{1,32}$/.test(id):/^\d{1,32}$/.test(id));
}

type OnlineAlbumPlatform=Exclude<AlbumSearchResult['platform'],'local'>;
const labels={wy:'网易云',tx:'QQ 音乐',kw:'酷我',kg:'酷狗',mg:'咪咕'};
const clean=(value:unknown)=>String(value??'').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\\+u0026/gi,'&').trim();
const names=(value:unknown)=>Array.isArray(value)?value.map(x=>x.name).filter(Boolean).join('、'):value;
const qqCover=(id:string)=>'https://y.gtimg.cn/music/photo_new/T002R500x500M000'+id+'.jpg';

async function upstream(platform:OnlineAlbumPlatform,url:string,signal:AbortSignal,headers?:Record<string,string>){
  const response=await requestPublic(url,{signal,headers});
  if(response.statusCode!==200)throw new Error(labels[platform]+'专辑服务暂不可用');
  return platform==='kw'&&typeof response.body==='string'?parseKuwoSearch(response.body):response.body as any;
}
async function qq(module:string,method:string,param:Record<string,unknown>,signal:AbortSignal){
  const response=await requestQqCatalog({comm:{ct:'19',cv:'2151',uin:'0'},req:{module,method,param}},signal);
  if(response?.code!==0||response.req?.code!==0||!response.req.data)throw new Error('QQ 音乐专辑服务暂不可用');
  return response.req.data;
}

async function miguSearch(keyword:string,page:number,album:boolean,signal:AbortSignal){
  const timestamp=String(Date.now()),device='963B7AA0D21511ED807EE5846EC87D20';
  const sign=createHash('md5').update(keyword+'6cdc72a439cef99a3418d2a78aa28c73'+'yyapp2d16148780a1dcc7408e06336b98cfd50'+device+timestamp).digest('hex');
  const params=new URLSearchParams({isCorrect:'0',isCopyright:'1',searchSwitch:JSON.stringify({song:Number(!album),album:Number(album),singer:0,tagSong:0,mvSong:0,bestShow:0,songlist:0,lyricSong:0}),pageSize:String(album?pageSize:50),text:keyword,pageNo:String(page),sort:'0',sid:'USS'});
  const data=await upstream('mg','https://jadeite.migu.cn/music_search/v3/search/searchAll?'+params,signal,{uiVersion:'A_music_3.6.1',deviceId:device,timestamp,sign,channel:'0146921'});
  if(data?.code!=='000000')throw new Error('咪咕搜索暂不可用');
  return album?data.albumResultData:data.songResultData;
}

async function onlineAlbums(platform:OnlineAlbumPlatform,keyword:string,page:number,signal:AbortSignal){
  const q=encodeURIComponent(keyword),offset=(page-1)*pageSize;
  const row=(id:unknown,name:unknown,artist:unknown,cover:unknown):AlbumSearchResult=>({
    id:String(id??''),platform,name:clean(name),artist:clean(artist)||'未知歌手',image:clean(cover).replace(/^http:/,'https:').replaceAll('{size}','400')||undefined,
  });
  let raw:any[], total:unknown, convert:(item:any)=>AlbumSearchResult;
  switch(platform){
    case 'wy': {
      const {result}=await netease('/api/search/get?s='+q+'&type=10&offset='+offset+'&limit='+pageSize,signal);
      raw=result?.albums??[];total=result?.albumCount;
      convert=item=>row(item.id,item.name,names(item.artists)||item.artist?.name,item.picUrl);
      break;
    }
    case 'tx': {
      const data=await qq('music.search.SearchCgiService','DoSearchForQQMusicDesktop',{grp:1,num_per_page:pageSize,page_num:page,query:keyword,remoteplace:'txt.newclient.top',search_type:2,searchid:randomBytes(16).toString('hex').toUpperCase()+'00001'},signal);
      raw=data.body?.album?.list??[];total=data.meta?.sum;
      convert=item=>row(item.albumMID??item.albumMid??item.mid,item.albumName??item.name,item.singerName||names(item.singer),item.albumPic||qqCover(item.albumMID??item.albumMid??item.mid));
      break;
    }
    case 'kw': {
      const data=await upstream('kw','http://search.kuwo.cn/r.s?all='+q+'&ft=album&itemset=album&pn='+(page-1)+'&rn='+pageSize+'&rformat=json&encoding=utf8',signal);
      if(!data||typeof data!=='object')throw new Error('酷我专辑搜索暂不可用');
      raw=data.albumlist??[];total=data.total??data.TOTAL;
      convert=item=>row(item.albumid??item.id,item.name,item.artist,item.hts_img||item.img);
      break;
    }
    case 'kg': {
      const data=await upstream('kg','https://mobiles.kugou.com/api/v3/search/album?version=9209&keyword='+q+'&page='+page+'&pagesize='+pageSize,signal);
      if(data?.status!==1||!data.data)throw new Error('酷狗专辑搜索暂不可用');
      raw=data.data.info??[];total=data.data.total;
      convert=item=>row(item.albumid,item.albumname,item.singername,item.imgurl);
      break;
    }
    case 'mg': {
      const data=await miguSearch(keyword,page,true,signal);
      raw=data?.result??data?.resultList??[];total=data?.totalCount;
      convert=item=>row(item.id??item.albumId,item.name,item.singer||names(item.singerList),item.imgItems?.[0]?.img);
      break;
    }
  }
  const albums=[...new Map(raw.flat().filter(Boolean).map(convert).filter(item=>validAlbumId(platform,item.id)&&item.name).map(item=>[item.id,item])).values()];
  return {albums,hasMore:raw.length>0&&(total==null?raw.length>=pageSize:offset+pageSize<Number(total))};
}

interface AlbumSearchPage {albums:AlbumSearchResult[];hasMore:boolean;platforms?:{platform:string;total:number;error:string|null}[]}
export async function searchAlbums(keyword:string,platform:string,page:number,signal:AbortSignal):Promise<AlbumSearchPage>{
  if(platform==='all'){
    const batches=await Promise.all(['local','wy','tx','kw','kg','mg'].map(async platform=>{
      try{return {platform,...await searchAlbums(keyword,platform,page,signal),error:null as string|null};}
      catch(error){
        if(signal.aborted)throw error;
        return {platform,albums:[] as AlbumSearchResult[],hasMore:false,error:'该平台搜索失败，请重试'};
      }
    }));
    const albums=[...batches[0].albums];
    for(let index=0;index<pageSize;index++)
      for(const batch of batches.slice(1))
        if(batch.albums[index])albums.push(batch.albums[index]);
    return {albums,hasMore:batches.some(batch=>batch.hasMore),platforms:batches.map(({platform,error})=>({platform,total:0,error}))};
  }
  const offset=(page-1)*pageSize;
  if(platform==='local'){
    const albums=localAlbums(keyword);
    return {albums:albums.slice(offset,offset+pageSize),hasMore:offset+pageSize<albums.length};
  }
  return onlineAlbums(platform as OnlineAlbumPlatform,keyword,page,AbortSignal.any([signal,AbortSignal.timeout(15000)]));
}

// Some services cap the number of tracks returned per request.
async function collect(load:(page:number)=>Promise<{rows:any[];more:boolean}>,maxPages=20){
  const rows:any[]=[];
  for(let page=1;page<=maxPages;page++){
    const result=await load(page);
    if(!Array.isArray(result.rows))throw new Error('无法读取专辑歌曲');
    rows.push(...result.rows);
    if(!result.more||!result.rows.length)break;
  }
  return rows;
}

export async function albumTracks(platform:string,id:string,signal:AbortSignal,albumName='',artist=''){
  if(platform==='local')return state.tracks.filter(track=>track.available&&JSON.stringify([track.album,track.artist])===id).map(publicTrack);
  signal=AbortSignal.any([signal,AbortSignal.timeout(20000)]);
  let rows:any[];
  const size=50;
  switch(platform){
    case 'wy': {
      const data=await netease('/api/v1/album/'+id,signal);
      if(!Array.isArray(data.songs))throw new Error('无法读取专辑歌曲');
      rows=data.songs.filter((item:any)=>item.id).map((item:any)=>({...item,al:{id,name:data.album?.name,picUrl:data.album?.picUrl,...item.al}}));
      break;
    }
    case 'tx':
      rows=(await collect(async page=>{
        const data=await qq('music.musichallAlbum.AlbumSongList','GetAlbumSongList',{albumMid:id,begin:(page-1)*size,num:size},signal);
        return {rows:data.songList,more:page*size<Number(data.totalNum)};
      })).map(item=>item.songInfo??item).filter(item=>item.mid);
      break;
    case 'kw':
      rows=(await collect(async page=>{
        const data=await upstream('kw','http://search.kuwo.cn/r.s?stype=albuminfo&albumid='+id+'&pn='+(page-1)+'&rn='+size+'&encoding=utf8&rformat=json',signal);
        const list=data?.musiclist??data?.musicList;
        return {rows:list?.map((item:any)=>({...item,id:item.musicrid??item.id,name:clean(item.songname??item.name),artist:clean(item.artist??data.artist),album:clean(data.name),albumid:id,albumpic:item.pic120??data.hts_img})),more:page*size<Number(data?.songnum)};
      })).filter(item=>item.id);
      break;
    case 'kg':
      rows=(await collect(async page=>{
        const data=await upstream('kg','https://mobiles.kugou.com/api/v3/album/song?albumid='+id+'&page='+page+'&pagesize='+size,signal);
        return {rows:data?.data?.info,more:page*size<Number(data?.data?.total)};
      })).filter(item=>item.audio_id).map(item=>({...item,album_name:item.album_name||albumName}));
      break;
    case 'mg': {
      const loadTracks=(albumId:string)=>collect(async page=>{
        const data=await upstream('mg','https://app.c.nf.migu.cn/MIGUM3.0/resource/album/song/v2.0?albumId='+albumId+'&pageNo='+page+'&pageSize='+size,signal);
        if(data?.code!=='000000')throw new Error('咪咕专辑服务暂不可用');
        return {rows:data.data?.songList,more:data.data?.hasNext===true};
      });
      rows=await loadTracks(id);
      // Album search can return a content ID. Resolve the catalog ID before loading the ordered track list.
      if(!rows.length&&albumName){
        const name=clean(albumName).replace(/[（(][^()（）]*《[^》]+》[^()（）]*[）)]$/,'').trim();
        const key=(s:unknown)=>clean(s).normalize('NFKC').toLowerCase().replace(/\s+/g,'');
        const result=await miguSearch(name,1,false,signal);
        const match=(result?.resultList??result?.result??[]).flat().find((item:any)=>
          validAlbumId('mg',String(item.albumId??''))&&Number(item.albumId)>2&&key(item.album)===key(name)&&
          (!artist||artist==='未知歌手'||key(names(item.singerList)??item.singer).includes(key(artist)))
        );
        if(match&&String(match.albumId)!==id)rows=await loadTracks(String(match.albumId));
      }
      rows=rows.filter(item=>item.songId&&item.copyrightId);

      break;
    }
    default: throw new Error('不支持的专辑平台');
  }
  const tracks=[...new Map(rows.map(item=>convertCatalogTrack(platform,item)).map(track=>[track.id,track])).values()];
  cacheCatalogTracks(tracks);
  return tracks.map(publicOnlineTrack);
}
