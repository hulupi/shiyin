// Service-owned host: no Vue app, UI timers, catalog refresh, or playback callbacks.
interface Host {
  config(): string;
  request(id: number, method: string, options: string): void;
  resolved(token: number, result: string, error: string): void;
}
const host = (globalThis as unknown as { ShiyinBackground: Host }).ShiyinBackground;
const config = JSON.parse(host.config());
localStorage.setItem('shiyin.android.sources', JSON.stringify(config.sources));
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
let requestId = 0;
function call(method: string, options: unknown) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    host.request(id, method, JSON.stringify(options));
  });
}
Object.assign(globalThis, {
  shiyinBackgroundNetwork: {
    request: (options: unknown) => call('request', options),
    audio: (options: unknown) => call('audio', options),
    connectionStatus: () => Promise.resolve({ connected: true }),
  },
  shiyinBackgroundReply(id: number, value: unknown, error: string) {
    const request = pending.get(id);
    pending.delete(id);
    if (error) request?.reject(new Error(error));
    else request?.resolve(value);
  },
  async shiyinResolve(token: number, track: unknown, quality: string) {
    try {
      const { resolveBackgroundTrack } = await import('./api');
      const result = await resolveBackgroundTrack(track as Parameters<typeof resolveBackgroundTrack>[0], quality);
      host.resolved(token, JSON.stringify(result), '');
    } catch (error) {
      host.resolved(token, '', error instanceof Error ? error.message : '后台取链失败');
    }
  },
});
host.resolved(0, '', '');
