function polyfill(target: object, key: PropertyKey, value: unknown) {
  if (!(key in target)) Object.defineProperty(target, key, { value, configurable: true, writable: true });
}

if (import.meta.env.MODE === "android") {
  polyfill(Array.prototype, "at", function <T>(this: T[], position: number) {
    const offset = Math.trunc(position) || 0;
    const index = offset < 0 ? this.length + offset : offset;
    return index < 0 || index >= this.length ? undefined : this[index];
  });

  polyfill(String.prototype, "replaceAll", function (this: string, search: string, replacement: string) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return String(this).replace(new RegExp(escaped, "g"), replacement);
  });

  polyfill(globalThis, "AggregateError", class extends Error {
    readonly name = "AggregateError";
    constructor(readonly errors: unknown[], message?: string) { super(message); }
  });

  polyfill(crypto, "randomUUID", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
  });

  const setReason = (signal: AbortSignal, reason: unknown) => {
    if (!("reason" in AbortSignal.prototype)) Object.defineProperty(signal, "reason", { value: reason });
  };
  const abortReason = (signal: AbortSignal) =>
    signal.reason ?? new DOMException("请求已取消", "AbortError");

  polyfill(AbortSignal.prototype, "throwIfAborted", function (this: AbortSignal) {
    if (this.aborted) throw abortReason(this);
  });

  polyfill(AbortSignal, "timeout", (milliseconds: number) => {
    const controller = new AbortController();
    setTimeout(() => {
      const error = new DOMException("请求超时", "TimeoutError");
      setReason(controller.signal, error);
      controller.abort(error);
    }, milliseconds);
    return controller.signal;
  });

  polyfill(AbortSignal, "any", (signals: AbortSignal[]) => {
    const controller = new AbortController();
    const listeners = new Map<AbortSignal, () => void>();
    const abort = (signal: AbortSignal) => {
      for (const [source, listener] of listeners) source.removeEventListener("abort", listener);
      const reason = abortReason(signal);
      setReason(controller.signal, reason);
      controller.abort(reason);
    };
    for (const signal of new Set(signals)) {
      if (signal.aborted) {
        abort(signal);
        break;
      }
      const listener = () => abort(signal);
      listeners.set(signal, listener);
      signal.addEventListener("abort", listener, { once: true });
    }
    return controller.signal;
  });
}
