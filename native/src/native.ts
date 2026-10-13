import { registerPlugin } from '@capacitor/core'

/**
 * The app's own native plugin (ios/App/App/SuiteShellPlugin.swift,
 * android/.../SuiteShellPlugin.java). It owns the lock: when "require unlock"
 * is on, the native side covers the app and asks for Face ID / Touch ID /
 * fingerprint on launch and after a spell in the background, on any page.
 */
export interface SuiteShellPlugin {
  /** Whether the phone can unlock with biometrics or a passcode, and whether the lock is on. */
  lockStatus(): Promise<{ available: boolean; kind: 'face' | 'touch' | 'fingerprint' | 'passcode' | 'none'; enabled: boolean }>
  /** Turn the lock on or off. Either way the person must pass the unlock prompt first. */
  setLockEnabled(options: { enabled: boolean }): Promise<{ enabled: boolean }>
  /** True when push can register without crashing (Android needs google-services.json in the build). */
  pushReady(): Promise<{ ready: boolean }>
  /** Colour of the status-bar / home-indicator zones, so they match the page's light or dark ground. */
  setChrome(options: { color: string; dark: boolean }): Promise<void>
}

export const SuiteShell = registerPlugin<SuiteShellPlugin>('SuiteShell')

export const KEY_COMPANY = 'cxo.company'
export const KEY_PUSH_ASKED = 'cxo.pushAsked'
