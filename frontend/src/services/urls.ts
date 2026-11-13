// Keep all browser requests under the gateway prefix in packaged builds.
export const appUrl = (url: string) => url.startsWith('/api/') || url === '/api'
  ? import.meta.env.BASE_URL.replace(/\/$/, '') + url
  : url;
