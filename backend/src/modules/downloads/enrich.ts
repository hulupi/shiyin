import { writeFile, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { getOnlineLyrics } from '../lyrics/online.js';
import { getOnlineCover } from '../catalog/cover.js';
import type { OnlineTrack } from '../catalog/service.js';
import { embedTags } from './tags.js';

export interface DownloadAssets { lyrics:string; cover?:{bytes:Buffer;type:string}; warnings:string[]; embeddedLyrics:boolean; embeddedCover:boolean }
export async function enrichAudio(
  file: string, extension: string, track: OnlineTrack, signal: AbortSignal,
  { saveLyrics = true, embedMetadata = true } = {},
):Promise<DownloadAssets> {
  const assets:DownloadAssets={lyrics:'',warnings:[],embeddedLyrics:false,embeddedCover:false};
  const original=await parseFile(file).catch(()=>undefined);
  assets.embeddedLyrics=Boolean(original?.common.lyrics?.length);
  assets.embeddedCover=Boolean(original?.common.picture?.length);
  let timer:ReturnType<typeof setTimeout>|undefined;
  const cover=Promise.race([getOnlineCover(track.id),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('封面获取超时')),20000);})]).finally(()=>clearTimeout(timer));
  const wantLyrics = saveLyrics || embedMetadata;
  const results=await Promise.allSettled([wantLyrics ? getOnlineLyrics(track,signal) : Promise.resolve(''),cover]);signal.throwIfAborted();
  if(results[0].status==='fulfilled')assets.lyrics=results[0].value;
  if(wantLyrics && !assets.lyrics)assets.lyrics=original?.common.lyrics?.map(item=>item.text||'').filter(Boolean).join('\n')||'';
  if(wantLyrics && !assets.lyrics)assets.warnings.push('未获取到歌词，可能为纯音乐或上游暂未提供');
  if(results[1].status==='fulfilled')assets.cover=results[1].value;
  else if(original?.common.picture?.[0]){const picture=original.common.picture[0];assets.cover={bytes:Buffer.from(picture.data),type:picture.format};}
  else assets.warnings.push('未获取到封面');
  if (!embedMetadata) return assets;
  if(!['mp3','flac'].includes(extension)){assets.warnings.push(`${extension.toUpperCase()} 暂不支持内嵌歌词和封面`);return assets;}
  const output=path.join(path.dirname(file),`.shiyin-tags-${randomUUID()}.part`);
  try{
    await embedTags(file,output,extension,track,assets.lyrics,assets.cover,signal);signal.throwIfAborted();
    // Runtime validation happens before replacing the downloaded temporary file.
    const metadata=await parseFile(output);
    if(assets.lyrics&&!metadata.common.lyrics?.length)throw new Error('写入后未读取到歌词');
    if(assets.cover&&!metadata.common.picture?.length)throw new Error('写入后未读取到封面');
    if(!metadata.format.codec)throw new Error('写入后无法识别音频');
    await rename(output,file);assets.embeddedLyrics=Boolean(metadata.common.lyrics?.length);assets.embeddedCover=Boolean(metadata.common.picture?.length);
  }catch(error){signal.throwIfAborted();assets.warnings.push(`内嵌写入失败，保留原音频：${error instanceof Error?error.message:'未知错误'}`);}
  finally{await unlink(output).catch(()=>{});}
  return assets;
}
export async function saveSidecars(file:string,assets:DownloadAssets,saveLyrics=true,preferEmbedded=false) {
  const base=file.slice(0,-path.extname(file).length);let lyricPath:string|undefined,coverPath:string|undefined;
  if(saveLyrics && assets.lyrics && !(preferEmbedded && assets.embeddedLyrics)){try{lyricPath=base+'.lrc';await writeFile(lyricPath,assets.lyrics+'\n',{encoding:'utf8',flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'){lyricPath=undefined;assets.warnings.push('歌词旁文件保存失败');}else if((await readFile(lyricPath!,'utf8').catch(()=>''))!==assets.lyrics+'\n')assets.warnings.push('同名歌词已存在且内容不同，未覆盖原文件');}}
  if(assets.cover && !(preferEmbedded && assets.embeddedCover)){const extension=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/avif':'avif'} as Record<string,string>)[assets.cover.type];if(extension)try{coverPath=base+'.'+extension;await writeFile(coverPath,assets.cover.bytes,{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'){coverPath=undefined;assets.warnings.push('封面旁文件保存失败');}else if(!(await readFile(coverPath!).catch(()=>Buffer.alloc(0))).equals(assets.cover.bytes))assets.warnings.push('同名封面已存在且内容不同，未覆盖原文件');}}
  return {lyricPath,coverPath};
}
