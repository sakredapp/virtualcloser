/**
 * CXO light / dark / auto (owner 10-09: "bring back light mode").
 *
 * The member's choice lives in localStorage under THEME_KEY: 'light' (the
 * default), 'dark' or 'auto'. <html data-theme> always holds the RESOLVED
 * look, 'light' or 'dark', so globals.css keeps one dark token block keyed
 * on [data-theme='dark']. <html data-theme-pref> holds the choice; for
 * 'auto' a media listener follows the Mac's setting live.
 *
 * THEME_SCRIPT runs inline in <head> before first paint so dark never
 * flashes light (and light never flashes dark).
 */
export const THEME_KEY = 'cx-theme'

export type ThemePref = 'light' | 'dark' | 'auto'

export const THEME_SCRIPT = `(function(){var d=document.documentElement;var q;try{q=window.matchMedia('(prefers-color-scheme: dark)')}catch(e){}function apply(p){if(p!=='dark'&&p!=='auto')p='light';d.setAttribute('data-theme-pref',p);d.setAttribute('data-theme',p==='auto'?(q&&q.matches?'dark':'light'):p)}var p='light';try{p=localStorage.getItem('${THEME_KEY}')||'light'}catch(e){}apply(p);if(q){var on=function(){if(d.getAttribute('data-theme-pref')==='auto')apply('auto')};if(q.addEventListener)q.addEventListener('change',on);else if(q.addListener)q.addListener(on)}window.__cxTheme=function(n){try{localStorage.setItem('${THEME_KEY}',n)}catch(e){}apply(n)}})();`
