import { requestPublic } from '../sources/network.js';
import { sources, requestSource } from '../sources/service.js';
import type { OnlineTrack } from '../catalog/service.js';

const cache=new Map<string,{text:string;expires:number}>();
function valid(value:unknown):string {
  if(typeof value!=='string')return '';
  const text=value.replace(/^\uFEFF/,'').trim();
  if(!text||text.length>1024*1024||/^\s*(?:<!doctype|<html|\{)/i.test(text)||/^(暂无歌词|没有歌词|纯音乐)[。！!]?$/i.test(text))return '';
  return text;
}
function stamp(seconds:number){const ms=Math.max(0,Math.round(seconds*1000));return `[${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}]`;}
export async function getOnlineLyrics(track:OnlineTrack,parent?:AbortSignal) {
  const hit=cache.get(track.id);if(hit&&hit.expires>Date.now())return hit.text;
  const signal=parent?AbortSignal.any([parent,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000);
  let text='';
  try{
    if(track.lyricUrl){const response=await requestPublic(track.lyricUrl,{signal,headers:{Referer:'https://app.c.nf.migu.cn/'}});if(response.statusCode===200)text=valid(response.text);}
    if(!text&&track.platform==='wy'){
      const data=(await requestPublic(`https://music.163.com/api/song/lyric?id=${encodeURIComponent(track.songId)}&lv=-1&kv=-1&tv=-1`,{signal})).body as any;text=valid(data.lrc?.lyric);
    }else if(!text&&track.platform==='kw'){
      const data=(await requestPublic(`https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encodeURIComponent(track.songId)}`,{signal})).body as any;
      if(Array.isArray(data.data?.lrclist))text=valid(data.data.lrclist.filter((line:any)=>Number.isFinite(Number(line.time))).map((line:any)=>stamp(Number(line.time))+String(line.lineLyric||'')).join('\n'));
    }else if(!text&&track.platform==='tx'){
      const data=(await requestPublic(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(track.songId)}&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&platform=yqq`,{signal,headers:{Referer:'https://y.qq.com/portal/player.html'}})).body as any;
      if(typeof data.lyric==='string')text=valid(data.lyric.includes('[')?data.lyric:Buffer.from(data.lyric,'base64').toString('utf8'));
    }else if(!text&&track.platform==='kg'){
      const hash=encodeURIComponent(String(track.musicInfo.hash||''));
      const data=(await requestPublic(`https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(track.title)}&hash=${hash}&timelength=${track.duration}&lrctxt=1`,{signal})).body as any;
      const candidate=data.candidates?.[0];if(candidate){const result=(await requestPublic(`https://lyrics.kugou.com/download?ver=1&client=pc&id=${encodeURIComponent(candidate.id)}&accesskey=${encodeURIComponent(candidate.accesskey)}&fmt=lrc&charset=utf8`,{signal})).body as any;if(result.fmt==='lrc'&&typeof result.content==='string')text=valid(Buffer.from(result.content,'base64').toString('utf8'));}
    }
  }catch{/* Try a source-provided lyric after platform failure. */}
  if(!text)for(const source of [...sources].sort((a,b)=>a.priority-b.priority)){
    signal.throwIfAborted();if(!source.enabled||!source.capabilities.local?.actions.includes('lyric'))continue;
    try{const result=await requestSource(source,{source:'local',action:'lyric',info:{musicInfo:track.musicInfo}},signal) as {lyric?:string};text=valid(result?.lyric);if(text)break;}catch{/* Try next compatible source. */}
  }
  if(text){cache.set(track.id,{text,expires:Date.now()+3600000});while(cache.size>500)cache.delete(cache.keys().next().value!);}
  return text;
}
