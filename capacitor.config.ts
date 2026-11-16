import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.shiyin.music',
  appName: '拾音',
  webDir: 'frontend/dist',
  android: { backgroundColor: '#101311' },
  plugins: { SystemBars: { style: 'DARK' } },
};

export default config;
