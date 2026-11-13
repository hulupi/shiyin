// Executed only inside QuickJS, with no Node.js runtime or module loader.
(() => {
  const host = (operation, args) => {
    const value = JSON.parse(__host(operation, JSON.stringify(args)));
    if (!value.ok) throw new Error(value.error);
    return value.result;
  };
  class Bytes extends Uint8Array {
    toString(encoding = 'utf8') { return host('bufferString', [Array.from(this), encoding]); }
    static from(value, encoding) {
      if (value instanceof ArrayBuffer) return new Bytes(new Uint8Array(value));
      if (ArrayBuffer.isView(value)) return new Bytes(new Uint8Array(value.buffer,value.byteOffset,value.byteLength));
      return new Bytes(host('bufferFrom', [typeof value === 'string' ? value : Array.from(value), encoding]));
    }
  }
  const serialize = value => value instanceof ArrayBuffer ? Array.from(new Uint8Array(value)) : ArrayBuffer.isView(value) ? Array.from(new Uint8Array(value.buffer,value.byteOffset,value.byteLength)) : value;
  const callbacks = new Map(), timerCallbacks = new Map();
  let sequence = 0, requestHandler;
  globalThis.window = globalThis;
  globalThis.self = globalThis;
  globalThis.console = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
  globalThis.atob = text => host('bufferString', [host('bufferFrom',[text,'base64']),'latin1']);
  globalThis.btoa = text => host('bufferString', [host('bufferFrom',[text,'latin1']),'base64']);
  globalThis.Buffer = Bytes;
  globalThis.TextEncoder = class { encode(text) { return Bytes.from(String(text)); } };
  globalThis.TextDecoder = class { constructor(encoding='utf8') { this.encoding=encoding; } decode(bytes) { return host('bufferString',[Array.from(bytes),this.encoding]); } };
  globalThis.URLSearchParams = class {
    constructor(input='') {
      if(typeof input==='string')this.entriesList=input.replace(/^\?/,'').split('&').filter(Boolean).map(part=>{const index=part.indexOf('=');return [index<0?part:part.slice(0,index),index<0?'':part.slice(index+1)].map(value=>decodeURIComponent(value.replace(/\+/g,' ')));});
      else this.entriesList=Array.isArray(input)?input.map(pair=>pair.map(String)):Object.entries(input).map(([key,value])=>[key,String(value)]);
    }
    get(key){return this.entriesList.find(pair=>pair[0]===key)?.[1]??null;}
    has(key){return this.entriesList.some(pair=>pair[0]===key);}
    append(key,value){this.entriesList.push([String(key),String(value)]);}
    delete(key){this.entriesList=this.entriesList.filter(pair=>pair[0]!==key);}
    set(key,value){this.delete(key);this.append(key,value);}
    toString(){return this.entriesList.map(pair=>pair.map(value=>encodeURIComponent(value).replace(/%20/g,'+')).join('=')).join('&');}
    entries(){return this.entriesList[Symbol.iterator]();}
    [Symbol.iterator](){return this.entries();}
  };
  globalThis.URL = class {
    constructor(value, base) { const parsed=host('url',[String(value),base]);this._base=parsed;this.searchParams=new URLSearchParams(parsed.search);Object.assign(this,parsed); }
    get href(){const base=this._base;return base.origin+base.pathname+(this.searchParams.toString()?'?'+this.searchParams:'')+base.hash;}
    set href(value){const parsed=host('url',[value]);this._base=parsed;this.searchParams=new URLSearchParams(parsed.search);}
    toString(){return this.href;}
  };
  globalThis.setTimeout = (callback, delay=0, ...args) => { const id=++sequence;timerCallbacks.set(id,()=>callback(...args));return __timer(id,Number(delay)); };
  globalThis.clearTimeout = id => __clearTimer(id);
  globalThis.__runTimer = id => { const fn=timerCallbacks.get(id);timerCallbacks.delete(id);fn?.(); };
  globalThis.__deliver = (id,result) => { const callback=callbacks.get(id);callbacks.delete(id);if(callback)callback(result.error?new Error(result.error):null,result.response,result.response?.body); };
  globalThis.__dispatch = request => {
    Promise.resolve().then(()=>{if(!requestHandler)throw new Error('未注册音源请求处理器');return requestHandler(request);})
      .then(value=>__emit(JSON.stringify({kind:'result',value})),()=>__emit(JSON.stringify({kind:'error',error:'音源未能解析该歌曲'})));
  };
  function request(url,options={},callback) {
    if(typeof options==='function'){callback=options;options={};}
    if(typeof callback!=='function')throw new Error('request 需要回调函数');
    if(callbacks.size>=16)throw new Error('音源并发请求过多');
    const id=++sequence;callbacks.set(id,callback);
    __emit(JSON.stringify({kind:'http',id,url:String(url),options}));
    return ()=>{callbacks.delete(id);__emit(JSON.stringify({kind:'cancelHttp',id}));};
  }
  const EVENT_NAMES=Object.freeze({inited:'inited',request:'request',updateAlert:'updateAlert'});
  globalThis.lx = {
    version:'1.2.0',env:'desktop',currentScriptInfo:__scriptInfo,EVENT_NAMES,request,
    on(event,handler){if(event===EVENT_NAMES.request && typeof handler==='function')requestHandler=handler;},
    send(event,data){if(event===EVENT_NAMES.inited)__emit(JSON.stringify({kind:'ready',data}));return Promise.resolve();},
    utils:{
      buffer:{from:Bytes.from,bufToString:(value,encoding)=>host('bufferString',[serialize(value),encoding])},
      crypto:{
        md5:value=>host('md5',[serialize(value)]),
        randomBytes:size=>new Bytes(host('random',[size])),
        aesEncrypt:(value,mode,key,iv)=>new Bytes(host('aes',[serialize(value),mode,serialize(key),serialize(iv)])),
        rsaEncrypt:(value,key)=>new Bytes(host('rsa',[serialize(value),key])),
      },
      zlib:{inflate:async value=>new Bytes(host('inflate',[serialize(value)])),deflate:async value=>new Bytes(host('deflate',[serialize(value)]))},
    },
  };
})();
