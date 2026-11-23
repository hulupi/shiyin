import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSource } from './executor.js';
import { scriptInfo } from './protocol.js';
import { sourceHttpTimeout } from './timeouts.js';
const header='/** @name Runtime compatibility test */\n';
const request={source:'kg',action:'musicUrl',info:{type:'320k',musicInfo:{songmid:'1'}}};
test('preserves the script original rejection message', async()=>{
 const script=header+`lx.on(lx.EVENT_NAMES.request,async()=>{throw new Error('所有接口均失败: HTTP 429');});lx.send(lx.EVENT_NAMES.inited,{sources:{kg:{actions:['musicUrl'],qualitys:['320k']}}});`;
 await assert.rejects(runSource(script,scriptInfo(script),request),/所有接口均失败: HTTP 429/);
});
test('lx.on returns a Promise as in LX Desktop', async()=>{
 const script=header+`lx.on(lx.EVENT_NAMES.request,async()=> 'https://audio.example/full.mp3').then(()=>lx.send(lx.EVENT_NAMES.inited,{sources:{kg:{actions:['musicUrl'],qualitys:['320k']}}}));`;
 assert.equal(await runSource(script,scriptInfo(script),request),'https://audio.example/full.mp3');
});
test('allows a fallback chain beyond the former 12 second deadline', {timeout:18000}, async()=>{
 const script=header+`lx.on(lx.EVENT_NAMES.request,async()=>new Promise(resolve=>setTimeout(()=>resolve('https://audio.example/full.flac'),12500)));lx.send(lx.EVENT_NAMES.inited,{sources:{kg:{actions:['musicUrl'],qualitys:['320k']}}});`;
 assert.equal(await runSource(script,scriptInfo(script),request),'https://audio.example/full.flac');
});
test('honors positive script timeouts up to the LX 60 second maximum',()=>{
 for(const value of [undefined,0,-1,NaN,'5000'])assert.equal(sourceHttpTimeout(value),60000);
 assert.equal(sourceHttpTimeout(5000),5000);assert.equal(sourceHttpTimeout(250),250);assert.equal(sourceHttpTimeout(120000),60000);
});
