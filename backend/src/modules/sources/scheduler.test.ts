import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SourceScheduler, type SourceAdapter } from './scheduler.js';
const source = (id: string, priority: number, resolve: SourceAdapter['resolve'] = async () => 'https://audio.example/song.m4a'): SourceAdapter => ({
  id, priority, enabled: true, platforms: ['wy'], qualities: ['320k', '128k'], resolve,
});
const song = {platform:'wy', songId:'1'};
test('attempts sources in settings priority order before lowering quality', async () => {
  const attempts: string[] = [];
  const scheduler = new SourceScheduler();
  const fail = async () => { throw new Error('no audio'); };
  await assert.rejects(scheduler.resolve([source('third',2,fail),source('first',0,fail),source('second',1,fail)],song,{
    qualities:['320k','128k'], cooldownMs:0, validate:async()=>{}, onAttempt:(id,q)=>attempts.push(id+'/'+q),
  }));
  assert.deepEqual(attempts,['first/320k','second/320k','third/320k','first/128k','second/128k','third/128k']);
});
test('disabled cooldown does not silently skip sources with past failures', async () => {
  const scheduler = new SourceScheduler(); let available=false;
  const entry=source('first',0,async()=>{if(!available)throw Error('unavailable');return 'https://audio.example/full.flac';});
  for(let i=0;i<3;i++) await assert.rejects(scheduler.resolve([entry],song,{qualities:['320k'],validate:async()=>{}}));
  available=true;
  const result=await scheduler.resolve([entry],song,{qualities:['320k'],cooldownMs:0,validate:async()=>{}});
  assert.equal(result.sourceId,'first');
});
test('logs rejected and unsupported skips and retains failure details', async () => {
  const skipped: string[]=[]; const failed: string[]=[];
  const unsupported=source('unsupported',0); unsupported.qualities=['flac'];
  await assert.rejects(new SourceScheduler().resolve([unsupported,source('rejected',1),source('bad',2,async()=>{throw Error('HTTP 403');})],song,{
    qualities:['320k'],cooldownMs:0,rejectedSourcesByQuality:new Map([['320k',new Set(['rejected'])]]),validate:async()=>{},
    onSkip:(id,_q,reason)=>skipped.push(id+':'+reason),onFailure:(_id,_q,_reason,message)=>failed.push(message||''),
  }));
  assert.deepEqual(skipped,['unsupported:unsupported','rejected:rejected']); assert.deepEqual(failed,['HTTP 403']);
});
test('validation receives source identity for correlated request logging', async () => {
  let identity:unknown;
  await new SourceScheduler().resolve([source('first',0)],song,{qualities:['320k'],validate:async(_url,_signal,context)=>{identity=context;}});
  assert.deepEqual(identity,{sourceId:'first',quality:'320k'});
});
