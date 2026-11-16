import { getQuickJS } from 'quickjs-emscripten';

export async function startSourceRuntime(input, bootstrap, postMessage, subscribe, { Buffer, createHash, createCipheriv, publicEncrypt, randomBytes, constants, inflateSync, deflateSync }) {
  const engine = await getQuickJS();
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(32 * 1024 * 1024);
  runtime.setMaxStackSize(1024 * 1024);
  let deadline = Date.now() + 1500;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();
  const timers = new Map();
  let timerId = 0;
  let ready = false;
  let scriptEvaluated = false;
  let initialization;

  function evaluate(code) {
    deadline = Date.now() + 1000;
    const result = vm.evalCode(code);
    if (result.error) { const error = vm.dump(result.error); result.error.dispose(); throw new Error(error?.message || '音源执行失败'); }
    result.value.dispose();
    pump();
  }
  function pump() {
    deadline = Date.now() + 1000;
    const result = runtime.executePendingJobs(100);
    if (result.error) { const error = vm.dump(result.error); result.error.dispose(); throw new Error(error?.message || '音源异步任务失败'); }
    if (runtime.hasPendingJob()) setTimeout(() => { try { pump(); } catch { fail(); } });
  }
  function fail() { postMessage({ kind: 'error', error: '音源脚本执行失败或使用了暂不支持的 API' }); }
  function expose(name, callback) {
    const handle = vm.newFunction(name, callback);
    vm.setProp(vm.global, name, handle);
    handle.dispose();
  }
  const buffer = value => Buffer.from(typeof value === 'string' ? value : value || []);
  expose('__host', (operationHandle, payloadHandle) => {
    try {
      const operation = vm.getString(operationHandle);
      const args = JSON.parse(vm.getString(payloadHandle));
      let result;
      switch (operation) {
        case 'bufferFrom': result = [...Buffer.from(args[0], args[1] || 'utf8')]; break;
        case 'bufferString': result = buffer(args[0]).toString(args[1] || 'utf8'); break;
        case 'md5': result = createHash('md5').update(buffer(args[0])).digest('hex'); break;
        case 'random': { const count = Number(args[0]); if (!Number.isInteger(count) || count < 0 || count > 65536) throw new Error(); result = [...randomBytes(count)]; break; }
        case 'aes': { const cipher = createCipheriv(args[1], buffer(args[2]), /-ecb$/i.test(args[1]) ? null : buffer(args[3])); result = [...Buffer.concat([cipher.update(buffer(args[0])), cipher.final()])]; break; }
        case 'rsa': {
          const value = buffer(args[0]); if (value.length > 128) throw new Error();
          result = [...publicEncrypt({ key: args[1], padding: constants.RSA_NO_PADDING }, Buffer.concat([Buffer.alloc(128-value.length),value]))]; break;
        }
        case 'inflate': result = [...inflateSync(buffer(args[0]), { maxOutputLength: 4 * 1024 * 1024 })]; break;
        case 'deflate': result = [...deflateSync(buffer(args[0]))]; break;
        case 'url': { const url = new URL(args[0], args[1]); result = { href:url.href, origin:url.origin, protocol:url.protocol, host:url.host, hostname:url.hostname, pathname:url.pathname, search:url.search, hash:url.hash }; break; }
        default: throw new Error();
      }
      return vm.newString(JSON.stringify({ ok:true, result }));
    } catch { return vm.newString(JSON.stringify({ ok:false, error:'音源工具参数无效或暂不支持' })); }
  });
  expose('__emit', handle => {
    const message = JSON.parse(vm.getString(handle));
    if (message.kind === 'ready') {
      if (ready) return vm.undefined;
      ready = true;
      if (!scriptEvaluated) { initialization = message; return vm.undefined; }
    }
    // Only JSON data crosses the WASM boundary, never host objects or functions.
    if (JSON.stringify(message).length > 1024 * 1024) throw new Error('音源响应过大');
    postMessage(message);
    return vm.undefined;
  });
  expose('__timer', (idHandle, delayHandle) => {
    if (timers.size >= 100) return vm.newNumber(-1);
    const id = ++timerId, callbackId = vm.getNumber(idHandle);
    timers.set(id, setTimeout(() => { timers.delete(id); try { evaluate(`__runTimer(${callbackId})`); } catch { fail(); } }, Math.max(0, Math.min(vm.getNumber(delayHandle),15000))));
    return vm.newNumber(id);
  });
  expose('__clearTimer', handle => { const id = vm.getNumber(handle); clearTimeout(timers.get(id)); timers.delete(id); return vm.undefined; });

  try {
    
    evaluate(`globalThis.__sourceEnvironment = ${JSON.stringify(input.environment || "desktop")}; globalThis.__scriptInfo = ${JSON.stringify(input.info)};`);
    evaluate(bootstrap);
    evaluate(input.script);
    scriptEvaluated = true;
    if (initialization) postMessage(initialization);
  } catch { fail(); }

  subscribe(message => {
    try {
      if (message.kind === 'httpResult') evaluate(`__deliver(${JSON.stringify(message.id)},${JSON.stringify(message.result)})`);
      else if (message.kind === 'dispatch') evaluate(`__dispatch(${JSON.stringify(message.request)})`);
    } catch { fail(); }
  });
}
