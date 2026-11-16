import { requestPublic } from "./network";

const cache = new Map<string, { url: string; expires: number }>();
const pending = new Map<string, Promise<string>>();
const waiting: (() => void)[] = [];
let active = 0;

export function androidArtworkUrl(value: string) {
  try {
    const url = new URL(value.startsWith("//") ? "https:" + value : value);
    if (url.username || url.password) return "";
    const cdn = /^(img\d+)\.kwcdn\.kuwo\.cn$/i.exec(url.hostname);
    if (cdn) {
      url.hostname = cdn[1] + ".kuwo.cn";
      url.protocol = "https:";
    }
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function cachedKuwoArtwork(id: string) {
  const saved = cache.get(id);
  return saved && saved.expires > Date.now() ? saved.url : undefined;
}

export function loadKuwoArtwork(id: string) {
  const saved = cachedKuwoArtwork(id);
  if (saved !== undefined) return Promise.resolve(saved);
  const existing = pending.get(id);
  if (existing) return existing;

  const task = (async () => {
    if (active >= 3) await new Promise<void>(resolve => waiting.push(resolve));
    else active++;
    let url = "";
    try {
      const songId = /^online:kw:(\d+)$/.exec(id)?.[1];
      if (songId) {
        const result = await requestPublic(
          "https://artistpicserver.kuwo.cn/pic.web?corp=kuwo&type=rid_pic&pictype=500&size=500&rid=" + songId,
          { timeout: 5000 },
          2048,
        );
        if (result.statusCode === 200) url = androidArtworkUrl(result.text.trim());
      }
    } catch {
      // The component keeps its placeholder and can retry later.
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
    cache.set(id, { url, expires: Date.now() + (url ? 30 * 60_000 : 60_000) });
    while (cache.size > 300) cache.delete(cache.keys().next().value!);
    return url;
  })().finally(() => pending.delete(id));
  pending.set(id, task);
  return task;
}
