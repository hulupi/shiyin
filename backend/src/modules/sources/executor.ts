import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { requestPublic, type RequestTrace } from './network.js';
import { scriptInfo, capabilities, type SourceEntry } from './protocol.js';
import { sourceHttpTimeout, SOURCE_INIT_TIMEOUT, SOURCE_REQUEST_TIMEOUT } from './timeouts.js';
let workerCount = 0;
const workerPath = fileURLToPath(new URL('../../source-runtime/worker.mjs', import.meta.url));
export async function runSource(script:string, info:ReturnType<typeof scriptInfo>, request?:unknown, signal?:AbortSignal,onTrace?:(trace:RequestTrace)=>void):Promise<unknown> {
  signal?.throwIfAborted();
  if(workerCount>=4)throw new Error('音源请求繁忙，请稍后重试');
  workerCount++;
  return new Promise((resolve,reject)=>{
    let worker:Worker;
    try{worker=new Worker(workerPath,{workerData:{script,info},resourceLimits:{maxOldGenerationSizeMb:64,stackSizeMb:4}});}catch{workerCount--;reject(new Error('无法启动音源运行环境'));return;}
    const requests=new Map<number,AbortController>();let count=0,done=false;
    const finish=(error?:Error,result?:unknown)=>{if(done)return;done=true;clearTimeout(timeout);signal?.removeEventListener('abort',abort);for(const controller of requests.values())controller.abort();void worker.terminate().finally(()=>workerCount--);error?reject(error):resolve(result);};
    const abort=()=>finish(new Error('音源请求已取消'));
    let timeout=setTimeout(()=>finish(new Error('音源初始化超时')),SOURCE_INIT_TIMEOUT);
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
    worker.on('error',()=>finish(new Error('音源运行环境异常')));
    worker.on('exit',()=>{if(!done)finish(new Error('音源运行环境提前退出'));});
    worker.on('message',async message=>{
      if(done)return;
      if(message.kind==='ready') {
        try {const declared=capabilities(message.data);if(request){clearTimeout(timeout);timeout=setTimeout(()=>finish(new Error('音源解析超时（20 秒）')),SOURCE_REQUEST_TIMEOUT);worker.postMessage({kind:'dispatch',request});}else finish(undefined,declared);}catch(error){finish(error as Error);}return;
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
        if(!body && options.form){body=new URLSearchParams(options.form).toString();headers['content-type']='application/x-www-form-urlencoded';}
        else if(!body && options.formData){const form=new FormData();for(const [key,value]of Object.entries(options.formData))form.set(key,String(value));const encoded=new Response(form);headers['content-type']=encoded.headers.get('content-type')!;body=Buffer.from(await encoded.arrayBuffer());}
        else if(body && typeof body==='object'){body=JSON.stringify(body);headers['content-type']??='application/json';}
        if(body && Buffer.byteLength(body)>1024*1024)throw new Error('请求体过大');
        const response=await requestPublic(String(message.url),{method:String(options.method||'GET').toUpperCase(),headers,body,idleTimeoutMs:sourceHttpTimeout(options.timeout),onTrace:trace=>{if(!done)onTrace?.(trace);},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(sourceHttpTimeout(options.timeout))])});
        if(!done)worker.postMessage({kind:'httpResult',id:message.id,result:{response:{statusCode:response.statusCode,headers:response.headers,body:response.body}}});
      }catch(error){if(!done)worker.postMessage({kind:'httpResult',id:message.id,result:{error:error instanceof Error?error.message.slice(0,1000):'音源网络请求失败'}});}
      finally{requests.delete(message.id);}
    });
  });
}
