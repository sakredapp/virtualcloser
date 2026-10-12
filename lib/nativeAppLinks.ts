/**
 * The two files Apple and Google fetch to prove the Suite CXO store app may
 * open suitecxo.com links (iOS universal links, Android App Links).
 *
 * Served only on Suite CXO hosts, at /.well-known/apple-app-site-association
 * and /.well-known/assetlinks.json. Every other host answers 404 exactly as
 * before. Pure: the routes pass in the host and the environment.
 *
 * Identifiers here must match native/ (capacitor.config.ts, the Xcode
 * project, android/app/build.gradle).
 */
import { brandFromHost } from '@/lib/brand'

/** Apple Developer team that publishes the app. */
export const APPLE_TEAM_ID = '35J234DF62'
export const IOS_BUNDLE_ID = 'com.suitecxo.app'
export const ANDROID_PACKAGE = 'com.suitecxo.app'

/**
 * Only the signed-in app and its sign-in pages open in the app. Marketing,
 * legal and booking pages stay in the browser.
 */
export const APP_PATHS = [
  '/dashboard',
  '/dashboard/*',
  '/login',
  '/reset-password',
  '/reset-password/*',
  '/set-password',
  '/set-password/*',
  '/welcome',
  '/welcome/*',
]

export function isSuiteCxoHost(host: string | null | undefined): boolean {
  return brandFromHost(host).key === 'cxo'
}

export function appleAppSiteAssociation() {
  return {
    applinks: {
      details: [
        {
          appIDs: [`${APPLE_TEAM_ID}.${IOS_BUNDLE_ID}`],
          components: APP_PATHS.map((path) => ({ '/': path })),
        },
      ],
    },
    webcredentials: { apps: [`${APPLE_TEAM_ID}.${IOS_BUNDLE_ID}`] },
  }
}

const SHA256 = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/

/**
 * Signing-certificate fingerprints from the environment, comma separated
 * (Play app signing key first, upload key second). Anything that is not a
 * SHA-256 fingerprint is dropped.
 */
export function androidFingerprints(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => SHA256.test(s))
}

/** Null until a fingerprint is set: the route answers 404 rather than a file Google would reject. */
export function androidAssetLinks(raw: string | null | undefined) {
  const fingerprints = androidFingerprints(raw)
  if (fingerprints.length === 0) return null
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ]
}
