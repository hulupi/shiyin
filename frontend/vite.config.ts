import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
const apiTarget = 'http://127.0.0.1:3180';

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [vue()],
  base: process.env.SHIYIN_BASE_PATH || "/",
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyRequest, request) => {
            const origin = request.headers.origin;
            if (!origin) return;
            try {
              const parsed = new URL(origin);
              // Only translate same-origin browser requests. Preserve foreign
              // origins so the backend continues to reject cross-site writes.
              if (['http:', 'https:'].includes(parsed.protocol) && parsed.host === request.headers.host) {
                proxyRequest.setHeader('origin', apiTarget);
              }
            } catch {
              // Leave invalid origins unchanged for the backend to reject.
            }
          });
        },
      },
    },
  },
});
