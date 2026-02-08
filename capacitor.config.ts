import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.metachain.app',
  appName: 'Metachain',
  webDir: 'build',
  server: {
    androidScheme: 'http',
    cleartext: true,
    allowNavigation: [
      "127.0.0.1",
      "localhost",
      "10.0.2.2"
    ]
  }
};

export default config;
