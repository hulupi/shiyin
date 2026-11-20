import { createHash } from 'node:crypto';
import { Router } from 'express';
import { requestPublic } from '../sources/network.js';
import { cached, createCatalogCache } from './charts.js';
import { cacheCatalogTracks, publicOnlineTrack, song, types, eapi, type OnlineTrack } from './service.js';
interface Playlist {id:string;name:string;image:string;description:string;update:string;count:number;group:string}
const platforms=new Set(['wy','tx','kw','kg','mg']);
const mobile='Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 Mobile';
const clean=(value:unknown)=>String(value??'').replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_match,code:string)=>{const point=code[0].toLowerCase()==='x'?parseInt(code.slice(1),16):Number(code);return point>0&&point<=0x10ffff?String.fromCodePoint(point):'';}).replace(/<br\s*\/?>/gi,' ').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"');
const image=(value:unknown)=>String(value||'').replaceAll('{size}','240').replace(/^http:/,'https:');
async function json(url:string,referer?:string){
  const response=await requestPublic(url,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':mobile,...referer?{Referer:referer}:{}}});
  if(response.statusCode!==200||!response.body||typeof response.body!=='object')throw Error('歌单服务暂不可用，请稍后重试');
  return response.body as any;
}
async function qq(module:string,method:string,param:Record<string,unknown>){
  const response=await json('https://u.y.qq.com/cgi-bin/musicu.fcg?data='+encodeURIComponent(JSON.stringify({comm:{ct:24,cv:4747474},req_1:{module,method,param}})),'https://y.qq.com/');
  if(response.code!==0||response.req_1?.code!==0)throw Error('QQ 音乐歌单暂不可用');return response.req_1.data;
}
function playlist(id:unknown,name:unknown,img:unknown,description:unknown,author:unknown,count:unknown,group='精选歌单'):Playlist {
  return {id:String(id),name:clean(name),image:image(img),description:clean(description),update:clean(author),count:Number(count)||0,group};
}
export function convertCatalogTrack(platform:string,item:any):OnlineTrack {
  if(platform==='wy'){
    const quality=types({'128k':item.l?.size,'320k':item.h?.size,flac:item.sq?.size,flac24bit:item.hr?.size});
    return song(platform,item.id,item.name,item.ar?.map((a:any)=>a.name).join('、'),item.al?.name,item.dt/1000,{songmid:item.id,albumId:item.al?.id,types:quality,_types:Object.fromEntries(quality.map(t=>[t.type,t]))},image(item.al?.picUrl));
  }
  if(platform==='tx'){
    const quality=types({'128k':item.file?.size_128mp3,'320k':item.file?.size_320mp3,flac:item.file?.size_flac,flac24bit:item.file?.size_hires});
    return song(platform,item.mid,item.title||item.name,item.singer?.map((a:any)=>a.name).join('、'),item.album?.name,item.interval,{songmid:item.mid,songId:item.id,albumId:item.album?.mid,albumMid:item.album?.mid,strMediaMid:item.file?.media_mid,types:quality,_types:Object.fromEntries(quality.map(t=>[t.type,t]))},item.album?.mid?`https://y.gtimg.cn/music/photo_new/T002R500x500M000${item.album.pmid||item.album.mid}.jpg`:undefined);
  }
  if(platform==='kw'){
    const quality=[...String(item.N_MINFO||item.MINFO||'').matchAll(/bitrate:(\d+),format:\w+,size:([\w.]+)/g)].map(m=>({type:({'128':'128k','320':'320k','2000':'flac','4000':'flac24bit'} as Record<string,string>)[m[1]],size:m[2]})).filter(t=>t.type);
    return song(platform,item.id,item.name,item.artist,item.album,item.duration,{songmid:item.id,albumId:item.albumid,types:quality,_types:Object.fromEntries(quality.map(t=>[t.type,t]))},image(item.albumpic)||undefined);
  }
  if(platform==='kg'){
    const quality=[['128k','filesize','hash'],['320k','320filesize','320hash'],['flac','sqfilesize','sqhash'],['flac24bit','filesize_high','hash_high']].filter(([,size])=>Number(item[size])>0).map(([type,size,hash])=>({type,size:item[size],hash:item[hash]}));
    const id=item.audio_id||item.album_audio_id||item.hash;
    return song(platform,id,item.songname||item.filename?.split(' - ').slice(1).join(' - '),item.authors?.map((a:any)=>a.author_name).join('、')||item.filename?.split(' - ')[0],item.album_name||'',item.duration,{songmid:id,albumId:item.album_id,albumAudioId:item.album_audio_id,hash:item.hash,types:quality,_types:Object.fromEntries(quality.map(t=>[t.type,t]))},image(item.album_sizable_cover||item.trans_param?.union_cover));
  }
  const quality=(item.audioFormats||[]).map((entry:any)=>({type:({PQ:'128k',HQ:'320k',SQ:'flac',ZQ24:'flac24bit'} as Record<string,string>)[entry.formatType],size:entry.asize||entry.isize})).filter((entry:any)=>entry.type);
  const cover=item.img3||item.img2||item.img1;
  return song(platform,item.songId,item.songName||item.name,item.singerList?.map((a:any)=>a.name).join('、')||item.singer,item.album,item.duration,{songmid:item.songId,copyrightId:item.copyrightId,albumId:item.albumId,types:quality,_types:Object.fromEntries(quality.map((t:any)=>[t.type,t]))},cover?image(cover.startsWith('/')?'https://d.musicapp.migu.cn'+cover:cover):undefined,item.lrcUrl);
}
interface FilterOption {id:string;name:string}
interface CategoryGroup {name:string;items:FilterOption[]}
export async function discoverFilters(platform:string,refresh=false){
  if(!platforms.has(platform))throw Error('不支持的歌单平台');
  return cached('discover:filters:'+platform,refresh,async()=>{
    let groups:CategoryGroup[]=[],sorts:FilterOption[]=[],categorySorts:FilterOption[]|undefined;
    if(platform==='wy'){
      const data=await json('https://music.163.com/api/playlist/catalogue');
      if(data.code!==200||!Array.isArray(data.sub))throw Error('网易云分类暂不可用');
      groups=Object.entries(data.categories||{}).map(([id,name])=>({name:clean(name),items:data.sub.filter((item:any)=>String(item.category)===id).map((item:any)=>({id:String(item.name),name:clean(item.name)}))}));
      sorts=[{id:'hot',name:'最热'}];
    }else if(platform==='tx'){
      const data=await qq('playlist.PlaylistAllCategoriesServer','get_all_categories',{qq:''});
      if(!Array.isArray(data.v_group))throw Error('QQ 音乐分类暂不可用');
      groups=data.v_group.map((group:any)=>({name:clean(group.group_name),items:(group.v_item||[]).map((item:any)=>({id:String(item.id),name:clean(item.name)}))}));
      sorts=[{id:'recommend',name:'推荐'},{id:'hot',name:'最热'},{id:'new',name:'最新'}];categorySorts=[{id:'recommend',name:'推荐'}];
    }else if(platform==='kw'){
      const data=await json('http://wapi.kuwo.cn/api/pc/classify/playlist/getTagList?cmd=rcm_keyword_playlist&user=0&prod=kwplayer_pc_9.0.5.0&vipver=9.0.5.0&source=kwplayer_pc_9.0.5.0&loginUid=0&loginSid=0&appUid=76039576');
      if(data.code!==200||!Array.isArray(data.data))throw Error('酷我分类暂不可用');
      groups=data.data.map((group:any)=>({name:clean(group.name),items:(group.data||[]).filter((item:any)=>String(item.digest)==='10000').map((item:any)=>({id:String(item.id),name:clean(item.name)}))}));
      sorts=[{id:'hot',name:'最热'},{id:'new',name:'最新'}];categorySorts=[{id:'recommend',name:'推荐'}];
    }else if(platform==='kg'){
      const data=await json('http://www2.kugou.kugou.com/yueku/v9/special/getSpecial?is_smarty=1');
      if(data.status!==1||!data.data?.tagids)throw Error('酷狗分类暂不可用');
      groups=Object.entries(data.data.tagids).map(([name,group]:[string,any])=>({name:clean(name),items:(group.data||[]).map((item:any)=>({id:String(item.id),name:clean(item.name)}))}));
      sorts=[{id:'recommend',name:'推荐'},{id:'hot',name:'最热'},{id:'new',name:'最新'}];
    }else{
      const data=await json('https://app.c.nf.migu.cn/pc/v1.0/template/musiclistplaza-taglist/release');
      if(data.code!=='000000'||!Array.isArray(data.data))throw Error('咪咕分类暂不可用');
      groups=data.data.map((group:any)=>({name:clean(group.header?.title),items:(group.content||[]).filter((item:any)=>item.texts?.[1]).map((item:any)=>({id:String(item.texts[1]),name:clean(item.texts[0])}))}));
      sorts=[{id:'recommend',name:'推荐'}];
    }
    return {sorts,categorySorts:categorySorts||sorts,groups:groups.filter(group=>group.items.length)};
  });
}
export async function mobileKugouPlaylists(page: number, refresh: boolean) {
  return cached('discover:kg:mobile:' + page, refresh, async () => {
    const data = await json('https://m.kugou.com/plist/index?json=true&page=' + page);
    const list = data.plist?.list;
    if (!Array.isArray(list?.info)) throw Error('酷狗歌单暂不可用');
    const charts = list.info.map((item: any) => playlist(
      item.specialid, item.specialname, item.imgurl || item.img, item.intro, item.nickname, item.songcount,
    ));
    const pageSize = Number(data.plist.pagesize || data.pagesize) || charts.length;
    return { charts, page, hasMore: charts.length > 0 && page * pageSize < Number(list.total) };
  });
}

export async function discoverPlaylists(platform:string,page=1,refresh=false,sort?:string,category='all'){
  if(!platforms.has(platform))throw Error('不支持的歌单平台');
  const filters=await discoverFilters(platform);
  if(category!=='all'&&!filters.groups.some(group=>group.items.some(item=>item.id===category)))throw Error('无效的歌单分类');
  const sorts=category==='all'?filters.sorts:filters.categorySorts;
  sort=sort||sorts[0].id;
  if(!sorts.some(item=>item.id===sort))throw Error('当前分类不支持该排序');
  return cached(`discover:list:${platform}:${sort}:${category}:${page}`,refresh,async()=>{
    let charts:Playlist[]=[],hasMore=false;
    if(platform==='wy'){
      const data=await json(`https://music.163.com/api/playlist/list?cat=${encodeURIComponent(category==='all'?'全部':category)}&order=${sort}&offset=${(page-1)*24}&limit=24`);
      if(data.code!==200||!Array.isArray(data.playlists))throw Error('网易云歌单暂不可用');
      charts=data.playlists.map((p:any)=>playlist(p.id,p.name,p.coverImgUrl,p.description,p.creator?.nickname,p.trackCount));hasMore=Boolean(data.more);
    }else if(platform==='tx'){
      if(category==='all'&&sort==='recommend'){
        const data=await qq('music.playlist.PlaylistSquare','GetRecommendWhole',{
          IsReqFeed:true,
          FeedReq:{From:(page-1)*24,Size:24},
        });
        if(!Array.isArray(data.FeedRsp?.List))throw Error('QQ 音乐推荐歌单暂不可用');
        charts=data.FeedRsp.List
          .map((entry:any)=>entry.Playlist?.basic)
          .filter((p:any)=>p?.tid)
          .map((p:any)=>playlist(p.tid,p.title,p.cover?.medium_url||p.cover?.default_url,p.desc,p.creator?.nick,p.song_cnt,'推荐歌单'));
        hasMore=Boolean(data.FeedRsp.HasMore);
      }else if(category==='all'){
        const data=await qq('playlist.PlayListPlazaServer','get_playlist_by_tag',{id:10000000,sin:(page-1)*24,size:24,order:sort==='new'?2:5,cur_page:page});
        if(!Array.isArray(data.v_playlist))throw Error('QQ 音乐歌单暂不可用');
        charts=data.v_playlist.map((p:any)=>playlist(p.tid,p.title,p.cover_url_medium,p.desc,p.creator_info?.nick,p.song_ids?.length));hasMore=page*24<Number(data.total);
      }else{
        const data=await qq('playlist.PlayListCategoryServer','get_category_content',{titleid:Number(category),caller:'0',category_id:Number(category),size:24,page:page-1,use_page:1});
        if(!Array.isArray(data.content?.v_item))throw Error('QQ 音乐分类歌单暂不可用');
        charts=data.content.v_item.map((entry:any)=>{const p=entry.basic;return playlist(p.tid,p.title,p.cover?.medium_url||p.cover?.default_url,p.desc,p.creator?.nick,p.song_cnt);});hasMore=page*24<Number(data.content.total_cnt);
      }
    }else if(platform==='kw'){
      const data=await json(`http://wapi.kuwo.cn/api/pc/classify/playlist/${category==='all'?'getRcmPlayList':'getTagPlayList'}?loginUid=0&loginSid=0&appUid=76039576&pn=${page}&rn=24&order=${sort}${category==='all'?'':'&id='+encodeURIComponent(category)}`);
      if(data.code!==200||!Array.isArray(data.data?.data))throw Error('酷我歌单暂不可用');
      charts=data.data.data.filter((p:any)=>String(p.digest)==='8').map((p:any)=>playlist(p.id,p.name,p.img,p.desc,p.uname,p.total));hasMore=page*24<Number(data.data.total);
    }else if(platform==='kg'){
      const tag=category==='all'?'':category;
      const data=await json(`http://www2.kugou.kugou.com/yueku/v9/special/getSpecial?is_ajax=1&cdn=cdn&t=${sort==='new'?7:sort==='hot'?6:5}&c=${encodeURIComponent(tag)}&p=${page}`);
      if(data.status!==1||!Array.isArray(data.special_db))throw Error('酷狗歌单暂不可用');
      const meta=await cached('discover:kg-count:'+tag,refresh,()=>json(`http://www2.kugou.kugou.com/yueku/v9/special/getSpecial?is_smarty=1&cdn=cdn&t=5&c=${encodeURIComponent(tag)}`));
      charts=data.special_db.map((p:any)=>playlist(p.specialid,p.specialname,p.img||p.imgurl,p.intro,p.nickname,p.songcount||p.song_count));hasMore=page*20<Number(meta.data?.params?.total)&&data.special_db.length>0;
    }else{
      const data=await json(category==='all'?`https://app.c.nf.migu.cn/pc/bmw/page-data/playlist-square-recommend/v1.0?templateVersion=2&pageNo=${page}`:`https://app.c.nf.migu.cn/pc/v1.0/template/musiclistplaza-listbytag/release?pageNumber=${page}&templateVersion=2&tagId=${encodeURIComponent(category)}`);
      if(data.code!=='000000'||(!Array.isArray(data.data?.contents)&&!Array.isArray(data.data?.contentItemList)))throw Error('咪咕歌单暂不可用');
      const seen=new Set<string>();
      function collect(items:any[]){for(const p of items){
        const id=String(p.resId||p.logEvent?.contentId||'');
        if((String(p.resType)==='2021'||String(p.logEvent?.contentType)==='2021')&&/^\d+$/.test(id)&&!seen.has(id)){seen.add(id);charts.push(playlist(id,p.txt||p.title,p.img||p.imageUrl,p.txt2,'',0));}
        if(Array.isArray(p.contents))collect(p.contents);if(Array.isArray(p.itemList))collect(p.itemList);
      }}
      collect(data.data.contents||data.data.contentItemList);hasMore=category==='all'?Number(data.data.header?.nextPageNo)>page:Boolean(data.data.nextPageUrl);

    }
    return {charts,hasMore:hasMore&&charts.length>0,page};
  });
}
async function discoverTrackPage(platform:string,id:string,page:number,refresh=false){
  return cached(`discover:detail:${platform}:${id}:${page}`,refresh,async()=>{
    let raw:any[]=[],total=0,pageSize=50;
    if(platform==='wy'){
      const data=await cached('discover:wy:'+id,refresh,()=>json(`https://music.163.com/api/v6/playlist/detail?id=${id}&n=1000&s=0`));
      if(data.code!==200||!Array.isArray(data.playlist?.tracks))throw Error('歌单不存在、未公开或暂不可用');
      const ids=(data.playlist.trackIds||[]).map((entry:any)=>String(entry.id));
      total=ids.length||data.playlist.tracks.length;
      const pageIds=ids.slice((page-1)*50,page*50);
      const known=new Map<string,any>(data.playlist.tracks.map((entry:any)=>[String(entry.id),entry]));
      const missing=pageIds.filter((entry:string)=>!known.has(entry));
      if(missing.length){const details=await eapi('/api/v3/song/detail',{c:JSON.stringify(missing.map((id:string)=>({id}))),ids:JSON.stringify(missing)},AbortSignal.timeout(15000));if(details.code!==200||!Array.isArray(details.songs))throw Error('歌单歌曲信息加载失败，请重试');for(const entry of details.songs)known.set(String(entry.id),entry);}
      raw=pageIds.length?pageIds.map((id:string)=>known.get(id)).filter(Boolean):data.playlist.tracks.slice((page-1)*50,page*50);
    }else if(platform==='tx'){
      const data=await qq('music.srfDissInfo.aiDissInfo','uniform_get_Dissinfo',{disstid:Number(id),userinfo:1,tag:1,orderlist:1,song_begin:(page-1)*50,song_num:50,onlysonglist:0,enc_host_uin:''});
      if(data.code!==0||!Array.isArray(data.songlist))throw Error('歌单不存在、未公开或暂不可用');
      raw=data.songlist;total=Number(data.total_song_num)||Number(data.dirinfo?.songnum)||0;
    }else if(platform==='kw'){
      const data=await json(`http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${id}&pn=${page-1}&rn=50&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1`);
      if(!Array.isArray(data.musiclist)||data.ispub===false)throw Error('歌单不存在、未公开或暂不可用');raw=data.musiclist;total=Number(data.total)||0;
    }else if(platform==='kg'){
      const data=await json(`https://mobiles.kugou.com/api/v3/special/song?specialid=${id}&page=${page}&pagesize=50&plat=0&version=8990`);
      if(!Array.isArray(data.data?.info))throw Error('歌单歌曲暂不可用');raw=data.data.info;total=Number(data.data.total)||0;
    }else{
      const data=await json(`https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0?pageNo=${page}&pageSize=50&playlistId=${id}`);
      if(data.code!=='000000'||!Array.isArray(data.data?.songList))throw Error('歌单不存在、未公开或暂不可用');raw=data.data.songList;total=Number(data.data.totalCount)||0;
    }
    const tracks=raw.map(item=>convertCatalogTrack(platform,item));return {tracks,total,page,hasMore:raw.length>0&&page*pageSize<total};
  });
}
export async function discoverTracks(platform:string,id:string,page=1,refresh=false){
  const result = await discoverTrackPage(platform, id, page, refresh);
  cacheCatalogTracks(result.tracks);return {...result,tracks:result.tracks.map(publicOnlineTrack)};
}
export async function collectDiscoverTracks(platform: unknown, id: unknown) {
  if (typeof platform !== 'string' || !['wy', 'tx', 'kw', 'kg', 'mg'].includes(platform)
      || typeof id !== 'string' || !/^\d{1,16}$/.test(id)) {
    throw new Error('无效的歌单来源');
  }
  const tracks = new Map<string, OnlineTrack>();
  for (let page = 1; page <= 500; page++) {
    const result = await discoverTrackPage(platform, id, page);
    if (result.total > 10000) throw new Error('歌单最多支持 10000 首歌曲');
    for (const track of result.tracks) tracks.set(track.id, track);
    if (!result.hasMore) return [...tracks.values()];
  }
  throw new Error('无法读取完整歌单');
}
// Some Kuwo endpoints return quoted strings using single quotes. Parse data only.
export function parseKuwoSearch(input:string){
  const normalized=input.replace(/"(?:\\.|[^"\\])*"|'((?:\\.|[^'\\])*)'/g,(token,content:string|undefined)=>{
    if(content===undefined)return token;
    return '"'+content.replace(/\\'/g,"'").replace(/"/g,'\\"')+'"';
  });
  try{return JSON.parse(normalized);}catch{throw Error('酷我返回的数据暂不可用');}
}
export async function searchPlaylists(platform:string,keyword:string,page=1,refresh=false){
  keyword=keyword.trim();
  if(!platforms.has(platform)||!keyword||keyword.length>100||!Number.isSafeInteger(page)||page<1||page>500)throw Error('无效的歌单搜索参数');
  return cached(`discover:search:${platform}:${keyword}:${page}`,refresh,async()=>{
    const q=encodeURIComponent(keyword),limit=24;
    let charts:Playlist[]=[],total=0;
    if(platform==='wy'){
      const data=await json(`https://music.163.com/api/search/get?s=${q}&type=1000&offset=${(page-1)*limit}&limit=${limit}`);
      if(data.code!==200||!data.result)throw Error('网易云歌单搜索暂不可用');
      charts=(data.result.playlists||[]).map((p:any)=>playlist(p.id,p.name,p.coverImgUrl,p.description,p.creator?.nickname,p.trackCount,'搜索结果'));total=Number(data.result.playlistCount)||0;
    }else if(platform==='tx'){
      const data=await json(`http://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist?page_no=${page-1}&num_per_page=${limit}&format=json&query=${q}&remoteplace=txt.yqq.playlist&inCharset=utf8&outCharset=utf-8`,'https://y.qq.com/');
      if(data.code!==0||!Array.isArray(data.data?.list))throw Error('QQ 音乐歌单搜索暂不可用');
      charts=data.data.list.map((p:any)=>playlist(p.dissid,p.dissname,p.imgurl,p.introduction,p.creator?.name,p.song_count,'搜索结果'));total=Number(data.data.sum)||0;
    }else if(platform==='kw'){
      const response=await requestPublic(`http://search.kuwo.cn/r.s?all=${q}&pn=${page-1}&rn=${limit}&rformat=json&encoding=utf8&ver=mbox&vipver=MUSIC_8.7.7.0_BCS37&plat=pc&ft=playlist&pay=0&needliveshow=0`,{signal:AbortSignal.timeout(15000)});
      if(response.statusCode!==200)throw Error('酷我歌单搜索暂不可用');
      const data=typeof response.body==='string'?parseKuwoSearch(response.body):response.body as any;
      if(!Array.isArray(data.abslist))throw Error('酷我歌单搜索暂不可用');
      charts=data.abslist.map((p:any)=>playlist(p.playlistid,p.name,p.pic,p.intro,p.nickname,p.songnum,'搜索结果'));total=Number(data.TOTAL)||0;
    }else if(platform==='kg'){
      const data=await json(`https://mobiles.kugou.com/api/v3/search/special?version=9209&keyword=${q}&pagesize=${limit}&filter=0&page=${page}&sver=2&with_res_tag=0`);
      if(data.status!==1||!Array.isArray(data.data?.info))throw Error('酷狗歌单搜索暂不可用');
      charts=data.data.info.map((p:any)=>playlist(p.specialid,p.specialname,p.imgurl,p.intro,p.nickname,p.songcount,'搜索结果'));total=Number(data.data.total)||0;
    }else{
      const timestamp=String(Date.now()),device='963B7AA0D21511ED807EE5846EC87D20';
      const sign=createHash('md5').update(keyword+'6cdc72a439cef99a3418d2a78aa28c73'+'yyapp2d16148780a1dcc7408e06336b98cfd50'+device+timestamp).digest('hex');
      const searchSwitch=encodeURIComponent(JSON.stringify({song:0,album:0,singer:0,tagSong:0,mvSong:0,bestShow:0,songlist:1,lyricSong:0}));
      const response=await requestPublic(`https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=1&isCopyright=1&searchSwitch=${searchSwitch}&pageSize=${limit}&text=${q}&pageNo=${page}&sort=0&sid=USS`,{signal:AbortSignal.timeout(15000),headers:{uiVersion:'A_music_3.6.1',deviceId:device,timestamp,sign,channel:'0146921'}});
      const data=response.body as any;
      if(response.statusCode!==200||data?.code!=='000000'||!data.songListResultData)throw Error('咪咕歌单搜索暂不可用');
      charts=(data.songListResultData.result||[]).map((p:any)=>playlist(p.id,p.name,p.musicListPicUrl,p.intro,p.userName,p.musicNum,'搜索结果'));total=Number(data.songListResultData.totalCount)||0;
    }
    return {charts,total,page,hasMore:charts.length>0&&page*limit<total};
  });
}
