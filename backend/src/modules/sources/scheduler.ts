/** Transport-independent scheduling. Script execution is supplied by the isolated runner. */
export interface SourceRequest { platform: string; songId: string; quality: string }
export interface SourceAdapter {
  id: string;
  enabled: boolean;
  priority: number;
  platforms: string[];
  qualities: string[];
  resolve(request: SourceRequest, signal: AbortSignal): Promise<string>;
}
export interface ResolveOptions {
  qualities: string[];
  rejectedSourcesByQuality?: ReadonlyMap<string, ReadonlySet<string>>;
  onAttempt?(sourceId: string, quality: string): void;
  onFailure?(sourceId: string, quality: string, reason: 'timeout' | 'unavailable'): void;
  totalTimeoutMs?: number;
  perSourceTimeoutMs?: number;
  cooldownMs?: number;
  signal?: AbortSignal;
  /** Must check that the URL actually opens an allowed audio resource. */
  validate(url: string, signal: AbortSignal): Promise<void>;
}
export class SourceScheduler {
  private cooldowns = new Map<string, number>();
  private failures = new Map<string, number>();
  reset(id: string) { this.cooldowns.delete(id); this.failures.delete(id); }

  async resolve(sources: SourceAdapter[], song: Omit<SourceRequest, 'quality'>, options: ResolveOptions) {
    const total = AbortSignal.timeout(options.totalTimeoutMs ?? 45000);
    const parent = options.signal ? AbortSignal.any([options.signal, total]) : total;
    const cooldownMs = options.cooldownMs ?? 60000;
    const errors: { sourceId: string; quality: string; reason: string }[] = [];
    for (const quality of [...new Set(options.qualities)]) {
      for (const source of [...sources].sort((a,b) => a.priority-b.priority)) {
        parent.throwIfAborted();
        if (!source.enabled || !source.platforms.includes(song.platform) || !source.qualities.includes(quality) || (this.cooldowns.get(source.id) ?? 0) > Date.now()) continue;
        if (options.rejectedSourcesByQuality?.get(quality)?.has(source.id)) continue;
        options.onAttempt?.(source.id, quality);
        const controller = new AbortController();
        const signal = AbortSignal.any([parent, controller.signal, AbortSignal.timeout(options.perSourceTimeoutMs ?? 12000)]);
        let aborted: (() => void) | undefined;
        try {
          const result = await Promise.race([
            (async () => {
              const url = await source.resolve({ ...song, quality }, signal);
              signal.throwIfAborted();
              if (!url) throw new Error('EMPTY_URL');
              const parsed = new URL(url);
              if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('INVALID_URL');
              await options.validate(url, signal);
              signal.throwIfAborted();
              return { sourceId: source.id, quality, url };
            })(),
            new Promise<never>((_resolve, reject) => {
              aborted = () => reject(new Error('SOURCE_TIMEOUT_OR_CANCELLED'));
              signal.addEventListener('abort', aborted, { once: true });
              if (signal.aborted) aborted();
            }),
          ]);
          this.reset(source.id);
          return result;
        } catch {
          parent.throwIfAborted();
          // Do not retain transport errors containing signed URLs or tokens.
          const reason = signal.aborted ? 'timeout' : 'unavailable';
          options.onFailure?.(source.id, quality, reason);
          errors.push({ sourceId: source.id, quality, reason: reason.toUpperCase() });
          if (cooldownMs > 0) {
            const failures = (this.failures.get(source.id) ?? 0) + 1;
            this.failures.set(source.id, failures);
            if (failures >= 3) this.cooldowns.set(source.id, Date.now() + cooldownMs);
          }
        } finally {
          if (aborted) signal.removeEventListener('abort', aborted);
          controller.abort();
        }
      }
    }
    throw new AggregateError(errors.map(item => new Error(`${item.sourceId}/${item.quality}: ${item.reason}`)), '没有可用音源');
  }
}
