import { registerPlugin } from '@capacitor/core';
import { Buffer } from 'buffer';

const legacyCatalogHosts = new Set(["c.y.qq.com","kbangserver.kuwo.cn","nplserver.kuwo.cn","qukudata.kuwo.cn","search.kuwo.cn","songsearch.kugou.com","wapi.kuwo.cn"]);

const bridge = registerPlugin<{
  request(options: {
    url: string; method: string; headers: Record<string, string>;
    body?: string; limit: number; timeout?: number;
  }): Promise<{ statusCode: number; headers: Record<string, string>; data: string }>;
  audio(options: { url: string }): Promise<{ path: string }>;
}>('ShiyinNetwork');

export async function requestPublic(url: string, options: {
  method?: string; headers?: Record<string, string>; body?: string | Uint8Array; signal?: AbortSignal; timeout?: number;
} = {}, limit = 4 * 1024 * 1024) {
  options.signal?.throwIfAborted();
  const target = new URL(url);
  if (target.protocol === 'http:' && legacyCatalogHosts.has(target.hostname)) target.protocol = 'https:';
  const response = await bridge.request({
    url: target.href, method: options.method || 'GET', headers: options.headers || {},
    body: options.body == null ? undefined : Buffer.from(options.body).toString('base64'),
    limit, timeout: options.timeout,
  });
  options.signal?.throwIfAborted();
  const text = Buffer.from(response.data, 'base64').toString('utf8').replace(/^\uFEFF/, '');
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* Some providers return text. */ }
  return { statusCode: response.statusCode, headers: response.headers, text, body };
}

export async function prepareAudio(url: string) {
  return (await bridge.audio({ url })).path;
}
