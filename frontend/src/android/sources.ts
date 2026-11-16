import { capabilities, scriptInfo, type SourceEntry } from '../../../backend/src/modules/sources/protocol';
import { requestPublic } from './network';
import { read, write } from './storage';

interface SavedSource extends SourceEntry { script: string }
const sourcesLimit = 20;
const scriptLimit = 1024 * 1024;
const sourceRecords = read<SavedSource[]>('sources', []);
const active = new Map<string, Set<AbortController>>();
let workerCount = 0;

export const sources: SourceEntry[] = sourceRecords;
export const sourceSettings = read('sourceSettings', { quality: '320k' });
export function saveSourceSettings() { write('sourceSettings', sourceSettings); }

function save(entries: SavedSource[]) {
  write('sources', entries);
  sourceRecords.splice(0, sourceRecords.length, ...entries);
}

export function publicSource({ script: _script, ...source }: SavedSource) {
  return source;
}

function run(script: string, request?: unknown, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  if (workerCount >= 4) throw new Error('音源请求繁忙，请稍后重试');
  const worker = new Worker(new URL('./source-worker.ts', import.meta.url), { type: 'module' });
  workerCount++;
  return new Promise((resolve, reject) => {
    let complete = false;
    let requests = 0;
    const pending = new Map<number, AbortController>();
    function finish(error?: unknown, value?: unknown) {
      if (complete) return;
      complete = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      for (const controller of pending.values()) controller.abort();
      worker.terminate();
      workerCount--;
      if (error) reject(error);
      else resolve(value);
    }
    const abort = () => finish(new DOMException('音源请求已取消', 'AbortError'));
    const timeout = setTimeout(() => finish(new Error('音源初始化或解析超时')), 15000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = () => finish(new Error('音源运行环境异常'));
    worker.onmessage = async ({ data }) => {
      if (complete) return;
      if (data.kind === 'ready') {
        try {
          const declared = capabilities(data.data);
          if (request) worker.postMessage({ kind: 'dispatch', request });
          else finish(undefined, declared);
        } catch (error) { finish(error); }
      } else if (data.kind === 'result') finish(undefined, data.value);
      else if (data.kind === 'error') finish(new Error(String(data.error).slice(0, 256)));
      else if (data.kind === 'cancelHttp') pending.get(data.id)?.abort();
      else if (data.kind === 'http') {
        if (++requests > 64 || pending.size >= 16) {
          finish(new Error('音源网络请求超过限制'));
          return;
        }
        const controller = new AbortController();
        pending.set(data.id, controller);
        const send = (result: unknown) => {
          if (!complete && !controller.signal.aborted) worker.postMessage({ kind: 'httpResult', id: data.id, result });
        };
        try {
          const options = data.options || {};
          const headers = Object.fromEntries(Object.entries(options.headers || {}).map(([key, value]) => [key, String(value)]));
          let body = options.body;
          if (options.form) {
            body = new URLSearchParams(options.form).toString();
            headers['content-type'] = 'application/x-www-form-urlencoded';
          } else if (options.formData) {
            const form = new FormData();
            for (const [key, value] of Object.entries(options.formData)) form.set(key, String(value));
            const encoded = new Response(form);
            headers['content-type'] = encoded.headers.get('content-type')!;
            body = new Uint8Array(await encoded.arrayBuffer());
          } else if (body && typeof body === 'object') {
            body = JSON.stringify(body);
            headers['content-type'] ??= 'application/json';
          }
          if (body && (typeof body === 'string' ? new TextEncoder().encode(body).length : body.length) > scriptLimit) {
            throw new Error('请求体过大');
          }
          const timeout = Math.min(12000, Math.max(1000, Number(options.timeout) || 12000));
          const response = await requestPublic(String(data.url), { method: String(options.method || 'GET'), headers, body, signal: controller.signal, timeout }, scriptLimit);
          send({ response: { statusCode: response.statusCode, headers: response.headers, body: response.body } });
        } catch {
          send({ error: '音源网络请求失败或地址不允许访问' });
        } finally { pending.delete(data.id); }
      }
    };
    try { worker.postMessage({ script, info: scriptInfo(script) }); }
    catch (error) { finish(error); }
  });
}

export function listSources() { return sourceRecords.map(publicSource); }

export async function importSource(script: string | undefined, url: string | undefined, signal?: AbortSignal) {
  if (script === undefined && url) {
    const response = await requestPublic(url.trim(), { signal }, scriptLimit);
    if (response.statusCode !== 200 || /text\/html/i.test(response.headers['content-type'] || '')) {
      throw new Error('无法下载音源脚本，请使用脚本直链');
    }
    script = response.text;
  }
  if (!script || new TextEncoder().encode(script).length > scriptLimit) throw new Error('请选择不超过 1 MB 的音源脚本');
  const info = scriptInfo(script);
  const check = () => {
    if (sourceRecords.length >= sourcesLimit) throw new Error('最多可导入 20 个音源');
    if (sourceRecords.some(entry => entry.script === script || (info.version && entry.name === info.name && entry.version === info.version))) {
      throw new Error('该音源已导入');
    }
  };
  check();
  const declared = await run(script, undefined, signal) as SourceEntry['capabilities'];
  check();
  const { rawScript: _raw, homepage: _homepage, ...fields } = info;
  const entry = { ...fields, script, id: crypto.randomUUID(), enabled: true, priority: sourceRecords.length,
    importedAt: new Date().toISOString(), capabilities: declared };
  save([...sourceRecords, entry]);
  return publicSource(entry);
}

export async function editSource(id: string, method: string, body: { enabled?: boolean; move?: string }, checking: boolean, signal?: AbortSignal) {
  const entry = sourceRecords.find(source => source.id === id);
  if (!entry) throw new Error('音源不存在');
  if (checking) {
    const declared = await run(entry.script, undefined, signal) as SourceEntry['capabilities'];
    const current = sourceRecords.find(source => source.id === id);
    if (!current) throw new Error('音源不存在');
    const updated = { ...current, capabilities: declared };
    save(sourceRecords.map(source => source.id === id ? updated : source));
    return { ok: true, entry: publicSource(updated) };
  }
  if (method === 'DELETE' || body.enabled === false) {
    for (const request of active.get(id) || []) request.abort();
  }
  const edited = method === 'DELETE' ? sourceRecords.filter(source => source.id !== id) : [...sourceRecords];
  if (method !== 'DELETE') {
    const index = edited.indexOf(entry);
    const target = index + (body.move === 'up' ? -1 : body.move === 'down' ? 1 : 0);
    edited[index] = { ...entry, enabled: body.enabled ?? entry.enabled };
    if (target >= 0 && target < edited.length) [edited[index], edited[target]] = [edited[target], edited[index]];
  }
  save(edited.map((source, priority) => ({ ...source, priority })));
  return method === 'DELETE' ? { ok: true } : publicSource(sourceRecords.find(source => source.id === id)!);
}

export async function requestSource(entry: SourceEntry, request: unknown, signal?: AbortSignal) {
  const record = sourceRecords.find(source => source.id === entry.id);
  if (!record?.enabled) throw new Error('音源已停用');
  const controller = new AbortController();
  const group = active.get(entry.id) || new Set<AbortController>();
  group.add(controller);
  active.set(entry.id, group);
  try {
    return await run(record.script, request, signal ? AbortSignal.any([signal, controller.signal]) : controller.signal);
  } finally {
    group.delete(controller);
    if (!group.size) active.delete(entry.id);
  }
}
