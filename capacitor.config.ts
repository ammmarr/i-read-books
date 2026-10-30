import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.ireadbooks.reader',
  appName: 'I read',
  webDir: 'dist',
  backgroundColor: '#0a0a0a',
  android: {
    // Books can be large; let the WebView keep them in memory while reading.
    allowMixedContent: false,
  },
  plugins: {
    // The status bar strip is drawn by MainActivity (edge to edge on every WebView, insets as CSS
    // variables); Capacitor's own handling padded it with a white window on older WebViews.
    SystemBars: {
      insetsHandling: 'disable',
    },
    // In-app updates: new web versions download from the website and switch
    // in (src/lib/update.ts). If one fails to start, the app falls back to
    // the version it was installed with.
    LiveUpdate: {
      readyTimeout: 10000,
      autoDeleteBundles: true,
      autoUpdateStrategy: 'none',
    },
  },
}

export default config
