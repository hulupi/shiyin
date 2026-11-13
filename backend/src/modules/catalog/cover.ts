import { getOnlineTrack, eapi, searchPlatform, type OnlineTrack } from './service.js';
import { openPublicUrl, requestPublic } from '../sources/network.js';
import { sources, requestSource } from '../sources/service.js';

const cache=new Map<string,{bytes:Buffer;type:string;expires:number}>();
const pending=new Map<string,Promise<{bytes:Buffer;type:string}>>();
let active=0;
const waiting:(()=>void)[]=[];
async function limited<T>(action:()=>Promise<T>) {
  if(active>=6)await new Promise<void>(resolve=>waiting.push(resolve));else active++;
  try{return await action();}finally{const next=waiting.shift();if(next)next();else active--;}
}
const normalize=(url:string)=>url.startsWith('//')?'https:'+url:url.replaceAll('{size}','400');
async function imageAddresses(track:OnlineTrack,signal:AbortSignal) {
  const addresses:string[]=[];
  if(track.image)addresses.push(normalize(track.image));
  if(track.platform==='kw') {
    const result=await requestPublic(`http://artistpicserver.kuwo.cn/pic.web?corp=kuwo&type=rid_pic&pictype=500&size=500&rid=${encodeURIComponent(track.songId)}`,{signal});
    if(/^https?:\/\//.test(result.text.trim()))addresses.push(result.text.trim());
  } else if(track.platform==='kg') {
    const result=(await requestPublic('http://media.store.kugou.com/v1/get_res_privilege',{method:'POST',headers:{'content-type':'application/json','KG-RC':'1','KG-THash':'expand_search_manager.cpp:852736169:451','user-agent':'KuGou2012-9020-ExpandSearchManager'},body:JSON.stringify({appid:1001,area_code:'1',behavior:'play',clientver:'9020',need_hash_offset:1,relate:1,resource:[{album_audio_id:track.musicInfo.songmid,album_id:track.musicInfo.albumId,hash:track.musicInfo.hash,id:0,name:`${track.artist} - ${track.title}.mp3`,type:'audio'}],token:'',userid:2626431536,vip:1}),signal})).body as any;
    const image=result?.data?.[0]?.info?.image;if(image)addresses.push(normalize(String(image)));
  } else if(track.platform==='wy'&&!addresses.length) {
    const result=await eapi('/api/v3/song/detail',{c:JSON.stringify([{id:track.songId}]),ids:JSON.stringify([track.songId])},signal);
    const image=result?.songs?.[0]?.al?.picUrl;if(image)addresses.push(image);
  }
  return addresses;
}
async function fetchImage(url:string,signal:AbortSignal,platform:string) {
  const referer=({wy:'https://music.163.com/',tx:'https://y.qq.com/',kw:'https://www.kuwo.cn/',kg:'https://www.kugou.com/',mg:'https://music.migu.cn/'} as Record<string,string>)[platform];
  const response=await openPublicUrl(normalize(url),{signal,headers:referer?{Referer:referer}:{}});
  if(response.statusCode!==200){response.destroy();throw new Error('封面请求失败');}
  let length=0;const chunks:Buffer[]=[];
  for await(const chunk of response){length+=chunk.length;if(length>4*1024*1024){response.destroy();throw new Error('封面过大');}chunks.push(Buffer.from(chunk));}
  const bytes=Buffer.concat(chunks);
  let type='';
  if(bytes[0]===0xff&&bytes[1]===0xd8)type='image/jpeg';
  else if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))type='image/png';
  else if(bytes.subarray(0,3).toString()==='GIF')type='image/gif';
  else if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')type='image/webp';
  else if(bytes.subarray(4,12).toString().startsWith('ftypavif'))type='image/avif';
  if(!type)throw new Error('返回内容不是有效图片');
  return {bytes,type};
}
async function platformCover(track:OnlineTrack,signal:AbortSignal){
  if(track.image)try{return await fetchImage(track.image,signal,track.platform);}catch{/* Try platform lookup. */}
  const addresses=await imageAddresses(track,signal);
  for(const address of new Set(addresses)){
    if(track.image&&address===normalize(track.image))continue;
    try{return await fetchImage(address,signal,track.platform);}catch{/* Try next address. */}
  }
  throw new Error('暂无可用封面');
}

const matchKey=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/[\s、,，&]/g,'');
async function crossPlatformCover(track:OnlineTrack,signal:AbortSignal){
  if(!track.title||!track.artist||track.artist==='未知歌手')throw new Error('暂无可用封面');
  const title=matchKey(track.title),artist=matchKey(track.artist);
  const album=track.album==='未知专辑'?'':matchKey(track.album);
  const request=new AbortController();
  const fallback=AbortSignal.any([signal,request.signal]);
  try{
    return await Promise.any(['wy','tx','kw','kg','mg'].filter(platform=>platform!==track.platform).map(async platform=>{
      const {tracks}=await searchPlatform(platform,(track.title+' '+track.artist).slice(0,100),1,fallback);
      const candidates=tracks.filter(candidate=>{
        if(matchKey(candidate.title)!==title||matchKey(candidate.artist)!==artist)return false;
        return candidate.duration&&track.duration
          ? Math.abs(candidate.duration-track.duration)<4
          : Boolean(album&&matchKey(candidate.album)===album);
      }).sort((a,b)=>Number(matchKey(b.album)===album)-Number(matchKey(a.album)===album));
      for(const candidate of candidates.slice(0,2)){
        fallback.throwIfAborted();
        try{return await platformCover(candidate,fallback);}catch{/* Try another matching release. */}
      }
      throw new Error('没有匹配封面');
    }));
  }catch{throw new Error('暂无可用封面');}
  finally{request.abort();}
}

export async function getOnlineCover(id:string) {
  const hit=cache.get(id);if(hit&&hit.expires>Date.now())return hit;
  if(pending.has(id))return pending.get(id)!;
  const task=limited(async()=>{
    const track=getOnlineTrack(id);
    const signal=AbortSignal.timeout(18000);
    const primary=AbortSignal.any([signal,AbortSignal.timeout(7000)]);
    try{return await platformCover(track,primary);}catch{/* Try configured sources, then other catalogs. */}
    const custom=AbortSignal.any([signal,AbortSignal.timeout(2500)]);
    for(const source of [...sources].sort((a,b)=>a.priority-b.priority)){
      if(custom.aborted)break;
      if(!source.enabled||!source.capabilities.local?.actions.includes('pic'))continue;
      try{const url=await requestSource(source,{source:'local',action:'pic',info:{musicInfo:track.musicInfo}},custom);if(typeof url==='string')return await fetchImage(url,custom,track.platform);}catch{/* Try next source. */}
    }
    return crossPlatformCover(track,signal);
  }).then(result=>{cache.set(id,{...result,expires:Date.now()+3600000});while([...cache.values()].reduce((sum,item)=>sum+item.bytes.length,0)>32*1024*1024||cache.size>200)cache.delete(cache.keys().next().value!);return result;}).finally(()=>pending.delete(id));
  pending.set(id,task);return task;
}
