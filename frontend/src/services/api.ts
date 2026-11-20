import { appUrl } from "./urls";
export async function requestApi(url: string, init: RequestInit = {}) {
  if (import.meta.env.MODE === "android") {
    const { requestAndroidApi } = await import("../android/api");
    return requestAndroidApi(url, init);
  }
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  headers.set('X-Shiyin-Request', '1');
  const response = await fetch(appUrl("/api" + url), {
    ...init,
    headers,
  }).catch(error => {
    init.signal?.throwIfAborted();
    if (!(error instanceof TypeError)) throw error;
    throw new Error(navigator.onLine === false
      ? "设备未连接网络，请检查网络后重试"
      : "无法连接拾音服务，请确认服务已启动且当前设备可以访问");
  });
  const result = await response
    .json()
    .catch(() => ({ error: "服务器响应异常" }));
  if (!response.ok) throw new Error(result.error || "请求失败");
  return result;
}
