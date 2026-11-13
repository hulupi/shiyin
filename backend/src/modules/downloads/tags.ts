import { createReadStream, createWriteStream } from 'node:fs';
import { open, writeFile, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import NodeID3 from 'node-id3';
import { imageSize } from 'image-size';
import type { OnlineTrack } from '../catalog/service.js';

interface Cover {bytes:Buffer;type:string}
const MAX_METADATA=16*1024*1024;
const uint32=(value:number,little=false)=>{const bytes=Buffer.alloc(4);little?bytes.writeUInt32LE(value):bytes.writeUInt32BE(value);return bytes;};
async function readAt(file:Awaited<ReturnType<typeof open>>,offset:number,length:number){if(length>MAX_METADATA)throw new Error('音频标签过大');const bytes=Buffer.alloc(length);let read=0;while(read<length){const result=await file.read(bytes,read,length-read,offset+read);if(!result.bytesRead)throw new Error('音频标签不完整');read+=result.bytesRead;}return bytes;}
async function streamWithHeader(input:string,output:string,header:Buffer,offset:number,signal:AbortSignal){await writeFile(output,header,{flag:'wx'});try{await pipeline(createReadStream(input,{start:offset}),createWriteStream(output,{flags:'a'}),{signal});}catch(error){await unlink(output).catch(()=>{});throw error;}}
function synchronized(text:string){
  const offset=Number(/\[offset:([+-]?\d+)\]/i.exec(text)?.[1]||0);
  return text.split(/\r?\n/).flatMap(line=>[...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)].map(match=>({timeStamp:Math.max(0,Math.round((Number(match[1])*60+Number(match[2]))*1000)+offset),text:line.replace(/\[[^\]]*\]/g,'').trim()}))).sort((a,b)=>a.timeStamp-b.timeStamp);
}
async function mp3(input:string,output:string,track:OnlineTrack,lyrics:string,cover:Cover|undefined,signal:AbortSignal){
  const file=await open(input,'r');let offset=0;let old:NodeID3.Tags={};
  try{
    const header=await readAt(file,0,10);
    if(header.subarray(0,3).toString()==='ID3'){
      if(header[6]>127||header[7]>127||header[8]>127||header[9]>127)throw new Error('无效 ID3 标签长度');
      const size=(header[6]<<21)|(header[7]<<14)|(header[8]<<7)|header[9];
      offset=10+size+(header[3]===4&&(header[5]&16)?10:0);
      old=NodeID3.read(await readAt(file,0,offset));
    }
  }finally{await file.close();}
  const tags:NodeID3.Tags={...old,title:track.title,artist:track.artist,album:track.album};
  if(lyrics){tags.unsynchronisedLyrics={language:'und',text:lyrics};const lines=synchronized(lyrics);if(lines.length)tags.synchronisedLyrics=[{language:'und',timeStampFormat:2,contentType:1,shortText:'Lyrics',synchronisedText:lines}];}
  if(cover)tags.image={mime:cover.type,type:{id:3},description:'Cover (front)',imageBuffer:cover.bytes};
  const header=NodeID3.create(tags);if(header.length>MAX_METADATA)throw new Error('生成的 ID3 标签过大');
  await streamWithHeader(input,output,header,offset,signal);
}
function comments(bytes:Buffer|undefined,track:OnlineTrack,lyrics:string){
  const entries:Buffer[]=[];let vendor:Buffer=Buffer.from('拾音');
  if(bytes){let cursor=0;const readLength=()=>{if(cursor+4>bytes.length)throw new Error('FLAC 注释损坏');const size=bytes.readUInt32LE(cursor);cursor+=4;return size;};const vendorSize=readLength();if(cursor+vendorSize>bytes.length)throw new Error('FLAC 注释损坏');vendor=bytes.subarray(cursor,cursor+vendorSize);cursor+=vendorSize;const count=readLength();if(count>100000)throw new Error('FLAC 注释数量异常');for(let i=0;i<count;i++){const length=readLength();if(cursor+length>bytes.length)throw new Error('FLAC 注释损坏');const value=bytes.subarray(cursor,cursor+length);cursor+=length;const key=value.toString('utf8').split('=',1)[0].toUpperCase();if(!['TITLE','ARTIST','ALBUM',...(lyrics?['LYRICS','UNSYNCEDLYRICS']:[])].includes(key))entries.push(value);}}
  for(const [key,value]of Object.entries({TITLE:track.title,ARTIST:track.artist,ALBUM:track.album,...(lyrics?{LYRICS:lyrics}:{})}))entries.push(Buffer.from(`${key}=${value}`,'utf8'));
  return Buffer.concat([uint32(vendor.length,true),vendor,uint32(entries.length,true),...entries.flatMap(value=>[uint32(value.length,true),value])]);
}
function picture(cover:Cover){const mime=Buffer.from(cover.type,'ascii');const dimensions=imageSize(cover.bytes);if(!dimensions.width||!dimensions.height)throw new Error('无法读取封面尺寸');return Buffer.concat([uint32(3),uint32(mime.length),mime,uint32(0),uint32(dimensions.width),uint32(dimensions.height),uint32(24),uint32(0),uint32(cover.bytes.length),cover.bytes]);}
async function flac(input:string,output:string,track:OnlineTrack,lyrics:string,cover:Cover|undefined,signal:AbortSignal){
  const file=await open(input,'r');const blocks:{type:number;bytes:Buffer}[]=[];let offset=4,oldComments:Buffer|undefined;
  try{
    if((await readAt(file,0,4)).toString()!=='fLaC')throw new Error('暂不支持带前置标签的 FLAC');
    let last=false;while(!last){signal.throwIfAborted();const header=await readAt(file,offset,4);last=Boolean(header[0]&128);const type=header[0]&127,length=header.readUIntBE(1,3);offset+=4;if(offset+length>MAX_METADATA)throw new Error('FLAC 元数据过大');const bytes=await readAt(file,offset,length);offset+=length;if(type===4)oldComments=bytes;else if(type!==1&&!(type===6&&cover&&bytes.length>=4&&bytes.readUInt32BE(0)===3))blocks.push({type,bytes});}
  }finally{await file.close();}
  if(blocks[0]?.type!==0)throw new Error('FLAC 缺少音频信息块');
  blocks.push({type:4,bytes:comments(oldComments,track,lyrics)});if(cover)blocks.push({type:6,bytes:picture(cover)});
  const headers=blocks.flatMap((block,index)=>{if(block.bytes.length>0xffffff)throw new Error('FLAC 标签过大');const header=Buffer.alloc(4);header[0]=block.type|(index===blocks.length-1?128:0);header.writeUIntBE(block.bytes.length,1,3);return [header,block.bytes];});
  await streamWithHeader(input,output,Buffer.concat([Buffer.from('fLaC'),...headers]),offset,signal);
}
/** Writes to a new temporary file and copies compressed audio bytes unchanged. */
export async function embedTags(input:string,output:string,extension:string,track:OnlineTrack,lyrics:string,cover:Cover|undefined,signal:AbortSignal){
  if(extension==='mp3')await mp3(input,output,track,lyrics,cover,signal);
  else if(extension==='flac')await flac(input,output,track,lyrics,cover,signal);
  else throw new Error(`${extension.toUpperCase()} 暂不支持内嵌写入，已保留旁文件`);
}
