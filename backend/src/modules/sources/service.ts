import { recordActivityException } from './activity.js';
import { randomUUID } from 'node:crypto';
import { loadRecords, replaceRecords, loadSetting, saveSetting, readScript, hasSourceScript, writeScript, deleteScript, transaction } from '../../db/database.js';
import type { RequestTrace } from './network.js';
import { requestPublic } from './network.js';
import { runSource } from './executor.js';
export { runSource } from './executor.js';

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
export function cancelSource(id:string) {for(const controller of active.get(id)||[])controller.abort();}
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
export async function requestSource(entry:SourceEntry,request:unknown,signal?:AbortSignal,onTrace?:(trace:RequestTrace)=>void) {
  if(!entry.enabled)throw new Error('音源已停用');
  const controller=new AbortController();const group=active.get(entry.id)||new Set<AbortController>();group.add(controller);active.set(entry.id,group);
  try {const script=readScript(entry.id);return await runSource(script,scriptInfo(script),request,signal?AbortSignal.any([signal,controller.signal]):controller.signal,onTrace);}
  finally{group.delete(controller);if(!group.size)active.delete(entry.id);}
}
