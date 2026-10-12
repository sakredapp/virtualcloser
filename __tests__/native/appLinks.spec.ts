/**
 * The verification files for the store app (lib/nativeAppLinks.ts): served on
 * Suite CXO hosts only, with the identifiers the native projects are built with.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ANDROID_PACKAGE,
  APPLE_TEAM_ID,
  IOS_BUNDLE_ID,
  androidAssetLinks,
  androidFingerprints,
  appleAppSiteAssociation,
  isSuiteCxoHost,
} from '@/lib/nativeAppLinks'

const root = path.resolve(__dirname, '../..')
const read = (p: string) => readFileSync(path.join(root, p), 'utf8')
const FP = Array.from({ length: 32 }, (_, i) => (i + 16).toString(16).toUpperCase()).join(':')

describe('which hosts serve the files', () => {
  it('Suite CXO hosts do', () => {
    expect(isSuiteCxoHost('suitecxo.com')).toBe(true)
    expect(isSuiteCxoHost('www.suitecxo.com')).toBe(true)
    expect(isSuiteCxoHost('pinnacle.suitecxo.com:443')).toBe(true)
  })
  it('every other host does not', () => {
    expect(isSuiteCxoHost('virtualcloser.com')).toBe(false)
    expect(isSuiteCxoHost('acme.virtualcloser.com')).toBe(false)
    expect(isSuiteCxoHost('localhost:3000')).toBe(false)
    expect(isSuiteCxoHost(null)).toBe(false)
  })
})

describe('apple-app-site-association', () => {
  it('names the app and only the app pages', () => {
    const file = appleAppSiteAssociation()
    const detail = file.applinks.details[0]
    expect(detail.appIDs).toEqual([`${APPLE_TEAM_ID}.${IOS_BUNDLE_ID}`])
    const paths = detail.components.map((c) => c['/'])
    expect(paths).toContain('/dashboard/*')
    expect(paths).toContain('/login')
    expect(paths.some((p) => p === '/' || p === '*' || p === '/*')).toBe(false)
    expect(paths.some((p) => p.startsWith('/cxo') || p.startsWith('/privacy'))).toBe(false)
  })
})

describe('assetlinks.json', () => {
  it('is absent until a fingerprint is set', () => {
    expect(androidAssetLinks(undefined)).toBeNull()
    expect(androidAssetLinks('')).toBeNull()
    expect(androidAssetLinks('not-a-fingerprint')).toBeNull()
  })
  it('lists valid fingerprints only', () => {
    expect(androidFingerprints(` ${FP.toLowerCase()} , junk`)).toEqual([FP])
    const file = androidAssetLinks(FP)
    expect(file?.[0].target.package_name).toBe(ANDROID_PACKAGE)
    expect(file?.[0].target.sha256_cert_fingerprints).toEqual([FP])
  })
})

describe('the native projects use the same identifiers', () => {
  it('Capacitor config', () => {
    expect(read('native/capacitor.config.ts')).toContain(`appId: '${IOS_BUNDLE_ID}'`)
  })
  it('Xcode project', () => {
    const pbx = read('native/ios/App/App.xcodeproj/project.pbxproj')
    expect(pbx).toContain(`PRODUCT_BUNDLE_IDENTIFIER = ${IOS_BUNDLE_ID};`)
    expect(pbx).toContain(`DEVELOPMENT_TEAM = ${APPLE_TEAM_ID};`)
  })
  it('Android project', () => {
    expect(read('native/android/app/build.gradle')).toContain(`applicationId "${ANDROID_PACKAGE}"`)
  })
  it('the app only claims suitecxo.com links', () => {
    const ent = read('native/ios/App/App/App.entitlements')
    const domains = [...ent.matchAll(/<string>applinks:([^<]+)<\/string>/g)].map((m) => m[1])
    expect(domains.sort()).toEqual(['*.suitecxo.com', 'suitecxo.com'])
    const hosts = [...read('native/android/app/src/main/AndroidManifest.xml').matchAll(/android:host="([^"]+)"/g)].map((m) => m[1])
    expect(hosts.sort()).toEqual(['*.suitecxo.com', 'suitecxo.com'])
  })
  it('the app never names the assistant anything but Ciao', () => {
    for (const f of ['native/www/index.html', 'native/www/offline.html', 'native/src/shell.ts', 'native/src/inject.ts']) {
      expect(read(f)).not.toMatch(/\bMira\b|\bCAIO\b|Chief AI Officer/)
    }
  })
})
