import { requestPublic } from '../sources/network.js';

const cacheMs = 10 * 60 * 1000;
let cached: { keywords: string[]; expires: number } | undefined;
let pending: Promise<string[]> | undefined;

export async function qqHotSearch() {
  if (cached && cached.expires > Date.now()) return cached.keywords;
  pending ??= fetchKeywords().finally(() => { pending = undefined; });
  return pending;
}

async function fetchKeywords() {
  const response = await requestPublic('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: { 'content-type': 'application/json', referer: 'https://y.qq.com/portal/player.html' },
    body: JSON.stringify({
      comm: { ct: '19', cv: '1803', tmeAppID: 'qqmusic', uin: '0' },
      hotkey: {
        module: 'tencent_musicsoso_hotkey.HotkeyService',
        method: 'GetHotkeyForQQMusicPC',
        param: { search_id: '', uin: 0 },
      },
    }),
    signal: AbortSignal.timeout(6000),
  });
  const data = response.body as {
    code?: number;
    hotkey?: { data?: { vec_hotkey?: { query?: unknown; kind?: number; jump_url?: string }[] } };
  } | null;
  const items = data?.hotkey?.data?.vec_hotkey;
  if (response.statusCode !== 200 || data?.code !== 0 || !Array.isArray(items))
    throw new Error('QQ 音乐热搜暂不可用');

  const keywords = [...new Set(items.flatMap(item => {
    // QQ's song entries use kind 2. Skip items that open a campaign page.
    if (item?.kind !== 2 || item.jump_url) return [];
    const text = typeof item.query === 'string' ? item.query.trim() : '';
    return text && text.length <= 100 ? [text] : [];
  }))].slice(0, 50);
  if (keywords.length) cached = { keywords, expires: Date.now() + cacheMs };
  return keywords;
}
