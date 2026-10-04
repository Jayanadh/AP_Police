import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android and iOS apps: the same Angular app, built with `npm run build:android` and `npm run build:ios` (see
 * docs/mobile-apps.md).
 */
const config: CapacitorConfig = {
  appId: 'in.gov.appolice.mto',
  appName: 'AP Police MTO',
  webDir: 'dist/frontend/browser',
  android: {
    // Keeps live locations reaching the app after five minutes in the background.
    useLegacyBridge: true,
    // From Android 15, Capacitor lays the app out below the status bar and above the navigation bar: the WebView's
    // own safe-area insets are not always right (after a start with the screen locked, for one).
    adjustMarginsForEdgeToEdge: 'auto',
    // Every plugin but the background geolocation one, which only the iOS app uses: the Android app has its own
    // live location service (android/app/src/main/java/in/gov/appolice/mto/location/). A plugin added to the app
    // must be listed here too to reach the Android app.
    includePlugins: [
      '@capacitor/filesystem',
      '@capacitor/local-notifications',
      '@capacitor/share',
      'capacitor-secure-storage-plugin',
    ],
  },
  plugins: {
    // Every API call goes through the phone's own HTTP: it keeps going in the background, where Android holds back
    // the WebView's, and needs no cross-site (CORS) set-up on the server.
    CapacitorHttp: { enabled: true },
  },
};

export default config;
