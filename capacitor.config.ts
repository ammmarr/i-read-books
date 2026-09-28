import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.ireadbooks.reader',
  appName: 'I Read Books',
  webDir: 'dist',
  backgroundColor: '#0a0a0a',
  android: {
    // Books can be large; let the WebView keep them in memory while reading.
    allowMixedContent: false,
  },
}

export default config
