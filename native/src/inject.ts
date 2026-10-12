/**
 * Runs on every hosted Suite CXO page the app shows (the native code adds it;
 * the website itself ships none of this, so the browser version is unchanged).
 *
 *   push       ask once after sign-in, hand the device token to the server,
 *              open the page a tapped notification points at
 *   links      universal links / suitecxo:// links that arrive while the app is open
 *   share      the phone's share sheet behind navigator.share (Android WebView has none)
 *   haptics    a light tap on buttons, tabs and the phone tab bar
 *   chrome     status-bar zone follows the page's light / dark ground
 *   company    remembers which company signed in, forgets it on sign-out
 *   offline    a quiet banner when the connection drops
 *   back       Android back button walks history, then leaves the app
 */
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { Network } from '@capacitor/network'
import { Preferences } from '@capacitor/preferences'
import { PushNotifications } from '@capacitor/push-notifications'
import { Share } from '@capacitor/share'
import { companyFromHost, isSuiteHost, resolveDeepLink } from './host'
import { KEY_COMPANY, KEY_PUSH_ASKED, SuiteShell } from './native'

declare global {
  interface Window {
    __cxNative?: boolean
    /** For the hosted app to call when it wants a native action (e.g. an "App settings" row). */
    SuiteCXONative?: {
      platform: string
      settings(): void
      share(data: { title?: string; text?: string; url?: string }): Promise<void>
      haptic(): void
    }
  }
}

const TOKEN_ENDPOINT = '/api/native/push-token'

function shellUrl(query = ''): string {
  // The local shell's own origin: capacitor://localhost on iOS, https://localhost on Android.
  const base = Capacitor.getPlatform() === 'android' ? 'https://localhost' : 'capacitor://localhost'
  return `${base}/index.html${query}`
}

function openLink(raw: string | undefined) {
  const link = resolveDeepLink(raw)
  if (link?.kind === 'open') window.location.assign(link.url)
  else if (link?.kind === 'settings') window.location.assign(shellUrl('?settings=1'))
}

async function rememberCompany() {
  const company = companyFromHost(window.location.hostname)
  const path = window.location.pathname
  if (path === '/logout' || path.startsWith('/logout/')) {
    await Preferences.remove({ key: KEY_COMPANY })
    await Preferences.remove({ key: KEY_PUSH_ASKED })
    return
  }
  if (company && path.startsWith('/dashboard')) await Preferences.set({ key: KEY_COMPANY, value: company })
}

function signedInPage(): boolean {
  return !!companyFromHost(window.location.hostname) && window.location.pathname.startsWith('/dashboard')
}

async function sendToken(token: string) {
  try {
    await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, platform: Capacitor.getPlatform() }),
    })
  } catch {
    // Offline or the route is not deployed yet: the next page load sends it again.
  }
}

async function push() {
  if (!signedInPage()) return
  if (!(await SuiteShell.pushReady().catch(() => ({ ready: false }))).ready) return

  await PushNotifications.addListener('registration', (t) => void sendToken(t.value))
  await PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
    const url = (a.notification.data as { url?: unknown } | undefined)?.url
    if (typeof url === 'string') openLink(url)
  })

  let state = (await PushNotifications.checkPermissions()).receive
  if (state === 'prompt' || state === 'prompt-with-rationale') {
    // Asked once, after sign-in, never on a cold open of the sign-in page.
    if ((await Preferences.get({ key: KEY_PUSH_ASKED })).value) return
    await Preferences.set({ key: KEY_PUSH_ASKED, value: '1' })
    state = (await PushNotifications.requestPermissions()).receive
  }
  if (state === 'granted') await PushNotifications.register()
}

function share() {
  const native = async (data: { title?: string; text?: string; url?: string }) => {
    await Share.share({ title: data.title, text: data.text, url: data.url, dialogTitle: data.title })
  }
  if (typeof navigator.share !== 'function') {
    Object.defineProperty(navigator, 'share', { configurable: true, value: native })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
  }
  return native
}

function haptics() {
  let last = 0
  const tap = () => {
    const now = Date.now()
    if (now - last < 80) return
    last = now
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
  }
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target instanceof Element ? e.target.closest('button, [role="button"], [role="tab"], nav a, [data-haptic]') : null
      if (el && !(el as HTMLButtonElement).disabled) tap()
    },
    { capture: true, passive: true },
  )
  return tap
}

function chrome() {
  const paint = () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark'
    const color = getComputedStyle(document.body).backgroundColor || (dark ? '#0E0F11' : '#F5F6F7')
    void SuiteShell.setChrome({ color, dark }).catch(() => {})
  }
  paint()
  new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
}

function offlineBanner() {
  let bar: HTMLDivElement | null = null
  const set = (connected: boolean) => {
    if (connected) {
      bar?.remove()
      bar = null
      return
    }
    if (bar) return
    bar = document.createElement('div')
    bar.setAttribute('role', 'status')
    bar.textContent = 'No connection. Showing what was already loaded.'
    bar.style.cssText =
      'position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:2147483646;' +
      'padding:10px 14px;border-radius:12px;background:#0F1012;color:#F2F3F5;border:1px solid #4A4F55;' +
      'font:500 13px/1.3 -apple-system,system-ui,sans-serif;text-align:center'
    document.body.appendChild(bar)
  }
  void Network.addListener('networkStatusChange', (s) => set(s.connected))
  void Network.getStatus().then((s) => set(s.connected)).catch(() => {})
}

function start() {
  if (window.__cxNative || !Capacitor.isNativePlatform() || !isSuiteHost(window.location.hostname)) return
  window.__cxNative = true
  const platform = Capacitor.getPlatform()
  document.documentElement.classList.add('cx-native', `cx-native-${platform}`)

  const nativeShare = share()
  const tap = haptics()
  window.SuiteCXONative = {
    platform,
    settings: () => window.location.assign(shellUrl('?settings=1')),
    share: nativeShare,
    haptic: tap,
  }

  chrome()
  offlineBanner()
  void rememberCompany()
  void push()
  void App.addListener('appUrlOpen', ({ url }) => openLink(url))
  void App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back()
    else void App.minimizeApp()
  })
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
else start()
