/**
 * The local shell: the first thing the app shows.
 *
 *   returning person  → "Opening <company>" → their dashboard
 *   first launch      → company address (or plain sign-in), lock toggle
 *   no connection     → offline panel with Try again
 *   suitecxo://settings (or ?settings=1) → the same screen, to change company or the lock
 *
 * The lock itself is native (SuiteShellPlugin); this page only turns it on or off.
 */
import { App } from '@capacitor/app'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import { Network } from '@capacitor/network'
import { Preferences } from '@capacitor/preferences'
import { SplashScreen } from '@capacitor/splash-screen'
import { normalizeCompany, resolveDeepLink, startUrl, ROOT_DOMAIN } from './host'
import { KEY_COMPANY, SuiteShell } from './native'
import { editionFrom } from './edition'

// Which store app this is (scripts/build.mjs bakes it in). Pinnacle's own app
// always opens Pinnacle; the Suite CXO app asks for the company.
declare const __CXO_EDITION__: string | undefined
const EDITION = editionFrom(typeof __CXO_EDITION__ === 'string' ? __CXO_EDITION__ : null)

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

function show(panel: 'opening' | 'entry' | 'offline') {
  for (const id of ['opening', 'entry', 'offline']) $(id).hidden = id !== panel
}

async function online(): Promise<boolean> {
  try {
    return (await Network.getStatus()).connected
  } catch {
    return navigator.onLine
  }
}

let pending: string | null = null

async function go(url: string, label?: string) {
  pending = url
  if (!(await online())) {
    show('offline')
    return
  }
  $('opening-label').textContent = label ? `Opening ${label}` : `Opening ${EDITION.appName}`
  show('opening')
  await SplashScreen.hide().catch(() => {})
  window.location.assign(url)
}

async function savedCompany(): Promise<string | null> {
  try {
    return normalizeCompany((await Preferences.get({ key: KEY_COMPANY })).value)
  } catch {
    return null
  }
}

const LOCK_LABEL: Record<string, string> = {
  face: 'Require Face ID to open',
  touch: 'Require Touch ID to open',
  fingerprint: 'Require fingerprint to open',
  passcode: 'Require the phone passcode to open',
}

async function paintLock() {
  const row = $('lock-row')
  const box = $<HTMLInputElement>('lock')
  try {
    const s = await SuiteShell.lockStatus()
    row.hidden = !s.available
    box.checked = s.enabled
    $('lock-label').textContent = LOCK_LABEL[s.kind] ?? LOCK_LABEL.passcode
  } catch {
    row.hidden = true
  }
}

async function showEntry(company: string | null) {
  $<HTMLInputElement>('company').value = company ?? ''
  $('entry-title').textContent = company ? 'App settings' : `Sign in to ${EDITION.appName}`
  $('forget').hidden = !company
  await paintLock()
  show('entry')
  await SplashScreen.hide().catch(() => {})
}

function wire() {
  $<HTMLFormElement>('entry-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const input = $<HTMLInputElement>('company')
    const err = $('company-error')
    const raw = input.value.trim()
    if (!raw) {
      // No address typed: the shared sign-in page sends each person to their own company.
      err.hidden = true
      void go(startUrl(null))
      return
    }
    const company = normalizeCompany(raw)
    if (!company) {
      err.textContent = `That is not a company address. It is the first part of your link, for example "acme" in acme.${ROOT_DOMAIN}.`
      err.hidden = false
      void Haptics.notification({ type: NotificationType.Error }).catch(() => {})
      return
    }
    err.hidden = true
    await Preferences.set({ key: KEY_COMPANY, value: company })
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
    void go(startUrl(company), company)
  })

  $('signin').addEventListener('click', () => void go(startUrl(null)))

  $('forget').addEventListener('click', async () => {
    await Preferences.remove({ key: KEY_COMPANY })
    void showEntry(null)
  })

  $<HTMLInputElement>('lock').addEventListener('change', async (e) => {
    const box = e.target as HTMLInputElement
    try {
      const r = await SuiteShell.setLockEnabled({ enabled: box.checked })
      box.checked = r.enabled
    } catch {
      box.checked = !box.checked
    }
  })

  $('retry').addEventListener('click', async () => {
    if (pending) return void go(pending)
    void boot()
  })

  // A link that arrives while the shell is on screen.
  void App.addListener('appUrlOpen', async ({ url }) => {
    const link = resolveDeepLink(url)
    if (link?.kind === 'open') void go(link.url)
    else if (link?.kind === 'settings') void showEntry(await savedCompany())
  })
  void Network.addListener('networkStatusChange', (s) => {
    if (s.connected && !$('offline').hidden && pending) void go(pending)
  })
}

async function boot() {
  const company = await savedCompany()
  if (new URLSearchParams(window.location.search).get('settings')) return showEntry(company)

  const launch = resolveDeepLink((await App.getLaunchUrl().catch(() => undefined))?.url)
  if (launch?.kind === 'settings') return showEntry(company)
  if (launch?.kind === 'open') return go(launch.url)
  if (company) return go(startUrl(company), company)
  // An edition made for one company opens it straight away; there is nothing to ask.
  if (EDITION.company) return go(startUrl(EDITION.company), EDITION.appName)
  return showEntry(null)
}

wire()
void boot()
// Never leave the launch image up if something above throws.
setTimeout(() => void SplashScreen.hide().catch(() => {}), 4000)
