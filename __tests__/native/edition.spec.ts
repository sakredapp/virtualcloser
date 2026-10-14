/**
 * The two store apps (native/src/edition.ts): Suite CXO, and Pinnacle Life
 * Group's own app. Every native project names the same identifiers.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EDITIONS, editionFrom } from '../../native/src/edition'
import { startUrl } from '../../native/src/host'

const root = path.resolve(__dirname, '../..')
const read = (p: string) => readFileSync(path.join(root, p), 'utf8')

describe('which app a build is', () => {
  it('is Suite CXO unless asked for Pinnacle', () => {
    expect(editionFrom(undefined).appId).toBe('com.suitecxo.app')
    expect(editionFrom('').appId).toBe('com.suitecxo.app')
    expect(editionFrom('acme').appId).toBe('com.suitecxo.app')
    expect(editionFrom(' Pinnacle ').appId).toBe('com.suitecxo.pinnacle')
  })
  it('Suite CXO asks for the company; Pinnacle opens Pinnacle', () => {
    expect(EDITIONS.suite.company).toBeNull()
    expect(EDITIONS.suite.appName).toBe('Suite CXO')
    expect(EDITIONS.pinnacle.appName).toBe('Pinnacle')
    expect(startUrl(EDITIONS.pinnacle.company)).toBe('https://pinnacle.suitecxo.com/dashboard')
  })
  it('never says Score', () => {
    expect(JSON.stringify(EDITIONS)).not.toMatch(/score/i)
  })
})

describe('the native projects', () => {
  it('Capacitor config and the shell read the edition', () => {
    expect(read('native/capacitor.config.ts')).toMatch(/editionFrom\(process\.env\.CXO_EDITION\)/)
    expect(read('native/scripts/build.mjs')).toContain('__CXO_EDITION__')
    expect(read('native/src/shell.ts')).toMatch(/if \(EDITION\.company\) return go\(startUrl\(EDITION\.company\)/)
  })
  it('Android has one flavor per edition, Suite CXO the default', () => {
    const g = read('native/android/app/build.gradle')
    expect(g).toMatch(/suite \{[^}]*isDefault = true[^}]*applicationId "com\.suitecxo\.app"/)
    expect(g).toMatch(/pinnacle \{[^}]*applicationId "com\.suitecxo\.pinnacle"/)
    const s = read('native/android/app/src/pinnacle/res/values/strings.xml')
    expect(s).toContain('<string name="app_name">Pinnacle</string>')
    expect(s).toContain('<string name="package_name">com.suitecxo.pinnacle</string>')
    expect(read('native/android/app/src/main/res/values/strings.xml')).toContain('<string name="app_name">Suite CXO</string>')
  })
  it('iOS keeps Suite CXO by default and takes the name as a build setting', () => {
    const pbx = read('native/ios/App/App.xcodeproj/project.pbxproj')
    expect(pbx.match(/PRODUCT_BUNDLE_IDENTIFIER = com\.suitecxo\.app;/g)).toHaveLength(2)
    expect(pbx.match(/CXO_DISPLAY_NAME = "Suite CXO";/g)).toHaveLength(2)
    expect(read('native/ios/App/App/Info.plist')).toMatch(/<key>CFBundleDisplayName<\/key>\s*<string>\$\(CXO_DISPLAY_NAME\)<\/string>/)
  })
})
