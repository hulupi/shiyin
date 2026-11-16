import { recordActivityException } from './activity.js';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { root } from '../../db/store.js';
import { loadRecords, replaceRecords, loadSetting, saveSetting, readScript, hasSourceScript, writeScript, deleteScript, transaction } from '../../db/database.js';
import { requestPublic } from './network.js';

import { platforms, scriptInfo, capabilities, type SourceEntry } from './protocol.js';
export { platforms, qualities, scriptInfo, type SourceEntry } from './protocol.js';

const supportedPlatforms = new Set<string>([...platforms, 'local']);
export const sources:SourceEntry[]=loadRecords<SourceEntry>('sources').map(source => ({
  ...source,
  capabilities: Object.fromEntries(Object.entries(source.capabilities).filter(([platform]) => supportedPlatforms.has(platform))),
}));
export const sourceSettings=loadSetting('sources',{quality:'320k'});
export async function saveSourceSettings(){saveSetting('sources',sourceSettings);}
export async function saveSources(){replaceRecords('sources',sources);}

const active = new Map<string,Set<AbortController>>();
let workerCount=0;
export function cancelSource(id:string) {for(const controller of active.get(id)||[])controller.abort();}
export async function runSource(script:string, info:ReturnType<typeof scriptInfo>, request?:unknown, signal?:AbortSignal):Promise<unknown> {
  signal?.throwIfAborted();
  if(workerCount>=4)throw new Error('音源请求繁忙，请稍后重试');
  workerCount++;
  return new Promise((resolve,reject)=>{
    let worker:Worker;
    try{worker=new Worker(path.join(root,'backend/src/source-runtime/worker.mjs'),{workerData:{script,info},resourceLimits:{maxOldGenerationSizeMb:64,stackSizeMb:4}});}catch{workerCount--;reject(new Error('无法启动音源运行环境'));return;}
    const requests=new Map<number,AbortController>();let count=0,done=false;
    const finish=(error?:Error,result?:unknown)=>{if(done)return;done=true;clearTimeout(timeout);signal?.removeEventListener('abort',abort);for(const controller of requests.values())controller.abort();void worker.terminate().finally(()=>workerCount--);error?reject(error):resolve(result);};
    const abort=()=>finish(new Error('音源请求已取消'));
    const timeout=setTimeout(()=>finish(new Error('音源初始化或解析超时')),15000);
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
    worker.on('error',()=>finish(new Error('音源运行环境异常')));
    worker.on('exit',()=>{if(!done)finish(new Error('音源运行环境提前退出'));});
    worker.on('message',async message=>{
      if(done)return;
      if(message.kind==='ready') {
        try {const declared=capabilities(message.data);if(request)worker.postMessage({kind:'dispatch',request});else finish(undefined,declared);}catch(error){finish(error as Error);}return;
      }
      if(message.kind==='result')return finish(undefined,message.value);
      if(message.kind==='error')return finish(new Error(String(message.error).slice(0,256)));
      if(message.kind==='cancelHttp'){requests.get(message.id)?.abort();return;}
      if(message.kind!=='http')return;
      if(++count>64||requests.size>=16)return finish(new Error('音源网络请求超过限制'));
      const controller=new AbortController();requests.set(message.id,controller);
      try {
        const options=message.options || {};const headers:Record<string,string>={};
        for(const [key,value]of Object.entries(options.headers||{}))headers[key]=String(value);
        let body=options.body;
        if(options.form){body=new URLSearchParams(options.form).toString();headers['content-type']='application/x-www-form-urlencoded';}
        else if(options.formData){const form=new FormData();for(const [key,value]of Object.entries(options.formData))form.set(key,String(value));const encoded=new Response(form);headers['content-type']=encoded.headers.get('content-type')!;body=Buffer.from(await encoded.arrayBuffer());}
        else if(body && typeof body==='object'){body=JSON.stringify(body);headers['content-type']??='application/json';}
        if(body && Buffer.byteLength(body)>1024*1024)throw new Error('请求体过大');
        const response=await requestPublic(String(message.url),{method:String(options.method||'GET').toUpperCase(),headers,body,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(Math.min(12000,Math.max(1000,Number(options.timeout)||12000)))])});
        if(!done)worker.postMessage({kind:'httpResult',id:message.id,result:{response:{statusCode:response.statusCode,headers:response.headers,body:response.body}}});
      }catch{if(!done)worker.postMessage({kind:'httpResult',id:message.id,result:{error:'音源网络请求失败或地址不允许访问'}});}
      finally{requests.delete(message.id);}
    });
  });
}
export const maxSourceBytes = 1024 * 1024;

function checkImport(script: string, info: ReturnType<typeof scriptInfo>) {
  if (hasSourceScript(script) || (info.version && sources.some(source =>
    source.name === info.name && source.version === info.version
  ))) throw new Error('该音源已导入，请在音源列表中查看');
  if (sources.length >= 20) throw new Error('最多可导入 20 个音源');
}

export async function importSource(script: string, signal?: AbortSignal) {
  if (Buffer.byteLength(script) > maxSourceBytes) throw new Error('音源脚本不能超过 1 MB');
  const info = scriptInfo(script);
  checkImport(script, info);
  const declared = await runSource(script, info, undefined, signal).catch(error => {
    if (!signal?.aborted) recordActivityException('导入音源失败', '音源脚本初始化失败，请检查脚本兼容性或重新导入。');
    throw error;
  }) as SourceEntry['capabilities'];
  signal?.throwIfAborted();
  // Another import may have completed while this script was initializing.
  checkImport(script, info);
  const entry: SourceEntry = {
    id: randomUUID(), name: info.name, version: info.version, author: info.author,
    description: info.description, enabled: true, priority: sources.length,
    importedAt: new Date().toISOString(), capabilities: declared,
  };
  transaction(() => {
    writeScript(entry.id, script);
    replaceRecords('sources', [...sources, entry]);
  });
  sources.push(entry);
  return entry;
}

export async function importSourceUrl(input: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(12000);
  const response = await requestPublic(input.trim(), {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  }, maxSourceBytes);
  if (response.statusCode !== 200) throw new Error(`音源链接下载失败（HTTP ${response.statusCode}）`);
  if (/text\/html/i.test(response.headers['content-type'] || ''))
    throw new Error('链接返回了网页，请使用音源脚本的 Raw 直链');
  return importSource(response.text, signal);
}
export async function checkSource(entry:SourceEntry) {
  try {
    const script = readScript(entry.id);
    entry.capabilities = await runSource(script, scriptInfo(script)) as SourceEntry['capabilities'];
    await saveSources();
    return entry;
  } catch (error) {
    recordActivityException('音源检查失败', '无法读取、初始化或保存此音源，请检查脚本后重试。');
    throw error;
  }
}
export function applyRestoredSources(entries: SourceEntry[]) {
  for (const entry of sources) cancelSource(entry.id);
  sources.splice(0, sources.length, ...entries);
}

export async function removeSource(entry:SourceEntry) {cancelSource(entry.id);sources.splice(sources.indexOf(entry),1);transaction(()=>{replaceRecords('sources',sources);deleteScript(entry.id);});}
export async function requestSource(entry:SourceEntry,request:unknown,signal?:AbortSignal) {
  if(!entry.enabled)throw new Error('音源已停用');
  const controller=new AbortController();const group=active.get(entry.id)||new Set<AbortController>();group.add(controller);active.set(entry.id,group);
  try {const script=readScript(entry.id);return await runSource(script,scriptInfo(script),request,signal?AbortSignal.any([signal,controller.signal]):controller.signal);}
  finally{group.delete(controller);if(!group.size)active.delete(entry.id);}
}
