/**
 * Which store app this build is. Pure, no imports, so capacitor.config.ts, the
 * build script, the shell and the web repo's tests can all read it
 * (__tests__/native/edition.spec.ts).
 *
 *   suite     com.suitecxo.app        "Suite CXO"  any company; asks for the company address
 *   pinnacle  com.suitecxo.pinnacle   "Pinnacle"   Pinnacle Life Group's own app; opens
 *                                                  pinnacle.suitecxo.com without asking
 *
 * Choose with CXO_EDITION at build time (`npm run sync:pinnacle`); unset is suite.
 * Each bundle ID is PERMANENT once its app record exists in App Store Connect and
 * Play Console. The same IDs are set in android/app/build.gradle (productFlavors)
 * and passed to xcodebuild for iOS (native/README section "Pinnacle edition").
 */
export type EditionKey = 'suite' | 'pinnacle'

export type Edition = {
  key: EditionKey
  /** iOS bundle identifier and Android applicationId. */
  appId: string
  /** The name under the icon. */
  appName: string
  /** The company the app always opens, or null to ask (the company-entry screen). */
  company: string | null
}

export const EDITIONS: Record<EditionKey, Edition> = {
  suite: { key: 'suite', appId: 'com.suitecxo.app', appName: 'Suite CXO', company: null },
  pinnacle: { key: 'pinnacle', appId: 'com.suitecxo.pinnacle', appName: 'Pinnacle', company: 'pinnacle' },
}

/** CXO_EDITION → the edition. Anything unknown (or unset) is the Suite CXO app, never a client's. */
export function editionFrom(raw: string | null | undefined): Edition {
  const k = String(raw ?? '').trim().toLowerCase()
  return k === 'pinnacle' ? EDITIONS.pinnacle : EDITIONS.suite
}
