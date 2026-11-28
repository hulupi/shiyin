import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.shiyin.music',
  appName: '拾音',
  webDir: 'frontend/dist',
  android: { backgroundColor: '#212924' },
  plugins: { SystemBars: { style: 'DARK', insetsHandling: 'native' } },
};

export default config;
