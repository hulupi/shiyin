import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';

const MAX_BODY = 4 * 1024 * 1024;
export async function openPublicUrl(input: string, options: {
  method?: string; headers?: Record<string, string>; body?: string | Buffer; signal?: AbortSignal;
} = {}, redirects = 0): Promise<http.IncomingMessage> {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || input.length > 8192) throw new Error('无效的外部地址');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => ipaddr.process(item.address).range() !== 'unicast')) throw new Error('禁止访问本地或保留网络地址');
  options.signal?.throwIfAborted();
  const address = addresses[0];
  const headers:Record<string,string> = { 'user-agent': 'Mozilla/5.0', ...options.headers };
  for (const name of Object.keys(headers)) if (/^(host|connection|content-length|transfer-encoding|proxy-.*)$/i.test(name)) delete headers[name];
  const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, {
      method: options.method || 'GET', headers, agent: false, signal: options.signal,
      lookup: ((_host: string, _options: unknown, callback: Function) => {
        // Pin the validated DNS answer, including Node's auto-family lookup mode.
        if ((_options as { all?: boolean })?.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      }) as never,
    }, resolve);
    request.setTimeout(15000, () => request.destroy(new Error('外部请求超时')));
    request.once('error', reject);
    request.end(options.body);
  });
  if ([301,302,303,307,308].includes(response.statusCode || 0) && response.headers.location) {
    response.destroy();
    if (redirects >= 4) throw new Error('外部重定向次数过多');
    const destination = new URL(response.headers.location, url);
    const next = { ...options, headers: { ...options.headers } };
    if (destination.origin !== url.origin) for (const key of Object.keys(next.headers)) if (/^(authorization|cookie)$/i.test(key)) delete next.headers[key];
    if (response.statusCode === 303 || ([301,302].includes(response.statusCode!) && options.method === 'POST')) { next.method = 'GET'; next.body = undefined; }
    return openPublicUrl(destination.href, next, redirects + 1);
  }
  return response;
}

export async function requestPublic(url: string, options: Parameters<typeof openPublicUrl>[1] = {}, maxBody = MAX_BODY) {
  const response = await openPublicUrl(url, options);
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of response) {
    size += chunk.length;
    if (size > maxBody) { response.destroy(); throw new Error(`外部响应超过 ${maxBody / 1024 ** 2} MB`); }
    chunks.push(Buffer.from(chunk));
  }
  let bytes=Buffer.concat(chunks);
  const encoding=response.headers['content-encoding'];
  if(encoding==='gzip')bytes=gunzipSync(bytes,{maxOutputLength:maxBody});
  else if(encoding==='deflate')bytes=inflateSync(bytes,{maxOutputLength:maxBody});
  else if(encoding==='br')bytes=brotliDecompressSync(bytes,{maxOutputLength:maxBody});
  const text = bytes.toString('utf8');
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* Non-JSON response. */ }
  return { statusCode: response.statusCode || 0, headers: response.headers, body, text };
}

export async function validateAudio(url: string, signal: AbortSignal) {
  const response = await openPublicUrl(url, { headers: { Range: 'bytes=0-1' }, signal });
  try {
    if (![200,206].includes(response.statusCode || 0)) throw new Error('音频地址不可用');
    const type = response.headers['content-type'] || '';
    if (/text\/|json|html|xml/i.test(type)) throw new Error('音源返回的不是音频');
  } finally { response.destroy(); }
}
