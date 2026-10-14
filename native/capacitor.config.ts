import type { CapacitorConfig } from '@capacitor/cli'
import { editionFrom } from './src/edition'

// Suite CXO store apps (App Store + Google Play).
//
// Suite CXO is a server-rendered Next app; it cannot be bundled into a native
// shell the way a static SPA can. So the app ships a small LOCAL shell (www/:
// company entry, opening screen, offline screen) and then navigates the same
// WebView to the hosted app at https://<company>.suitecxo.com.
//
// Why not `server.url`: Capacitor documents it as a live-reload setting, not
// for production, and it gives no screen of our own before the network answers.
// `allowNavigation` keeps the customer's hosts inside the WebView (everything
// else opens in the system browser) and the native bridge stays available on
// those hosts, which is what lets push, share, haptics and the lock work on
// the hosted pages. `errorPath` is the local page shown when a load fails.
//
// Build: `npm run sync` in this folder (bundles src/ into www/, then cap sync).
// The bundle ID is PERMANENT once the app record exists in App Store Connect
// and Play Console. Same pattern as com.virtualcloser.app / com.runmyads.app.
const GROUND = '#0E0F11'

// Which store app: CXO_EDITION=pinnacle builds Pinnacle's own app
// (com.suitecxo.pinnacle); unset is Suite CXO (src/edition.ts).
const edition = editionFrom(process.env.CXO_EDITION)

// Local testing only: CXO_DEV_ORIGIN=http://localhost:3490 lets the WebView
// stay on a local server (see src/host.ts). Unset for a store build.
const devHost = (() => {
  try {
    return process.env.CXO_DEV_ORIGIN ? new URL(process.env.CXO_DEV_ORIGIN).hostname : null
  } catch {
    return null
  }
})()

const config: CapacitorConfig = {
  appId: edition.appId,
  appName: edition.appName,
  webDir: 'www',
  backgroundColor: GROUND,
  // How the hosted pages know they are inside the store app (lib/nativeApp.ts
  // in the web repo): billing and pricing are closed there, as the stores require.
  appendUserAgent: 'SuiteCXOApp/1.0',
  server: {
    // A local test build can reach ONLY the local server, never the live app.
    allowNavigation: devHost ? [devHost] : ['suitecxo.com', '*.suitecxo.com'],
    errorPath: 'offline.html',
    androidScheme: 'https',
  },
  ios: {
    contentInset: 'never',
  },
  plugins: {
    SplashScreen: {
      // The shell hides it once its own first screen has painted.
      launchAutoHide: false,
      backgroundColor: GROUND,
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
}

export default config
