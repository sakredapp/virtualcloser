/**
 * The Whop Pixel on the public Suite CXO site (www.suitecxo.com).
 *
 * Suite CXO is paid through its own Whop business. The pixel ties each visit
 * and ad click to the Whop payment. Whop records its own checkout (views,
 * purchases, subscriptions) server-side, so we never send `purchase`: a second
 * copy would count the sale twice. We only send what Whop cannot see:
 *   - `page` on load and on each client-side route change (allowed paths only);
 *   - `lead` when the "Book a call" form (/cxo/request-access) is saved;
 *   - `complete_registration` when a company signs its onboarding link, sent
 *     from the server (lib/billing/whopServerEvents.ts) because that page's URL
 *     carries a secret token and the pixel never runs on it.
 *
 * Where it loads (default deny): only www.suitecxo.com / suitecxo.com, only the
 * public selling pages below, never in the store app's WebView. Never on a
 * company's own host (pinnacle.suitecxo.com, mike.suitecxo.com), never inside
 * the signed-in app, never on a page whose URL carries a token: the pixel
 * sends the full page URL (location.href) with every event.
 *
 * Pure and edge-safe. Vault: 07 Tasks/2026-10-22 Whop Pixel on Every Business Site.
 */
import { isCxoMarketingHost } from './seo'
import { isNativeAppUA } from './nativeApp'

/** The Suite CXO Whop business. A public identifier, not a secret. */
export const CXO_WHOP_PIXEL_ACCOUNT_ID = 'biz_SPZ04AFkJaua4I'
/** Where the pixel script and its events live. */
export const WHOP_PIXEL_ORIGIN = 'https://t.whop.tw'

/** Public selling pages, matched exactly. '/' is the home (served from /cxo). */
const PIXEL_PATHS_EXACT = ['/', '/cxo', '/pricing'] as const
/** Public selling pages, with everything under them. */
const PIXEL_PATH_PREFIXES = [
  '/cxo/request-access', // Book a call (the lead form)
  '/cxo/sizing', // private server quote
  '/cxo/demo', // the sales demo
  '/login',
  '/forgot-password',
  // Not /privacy, /terms, /support: legal and help pages carry no pixel (same as crmbuilds).
] as const

function cleanPath(pathname: string | null | undefined): string {
  let p = String(pathname ?? '/').split('?')[0].split('#')[0].replace(/\/{2,}/g, '/').toLowerCase()
  if (!p.startsWith('/')) p = `/${p}`
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p
}

/** May the pixel fire on this path of the public site? Default deny. */
export function cxoPixelPathAllowed(pathname: string | null | undefined): boolean {
  const p = cleanPath(pathname)
  if ((PIXEL_PATHS_EXACT as readonly string[]).includes(p)) return true
  return PIXEL_PATH_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`))
}

/** May the pixel be on this response at all? Public host, a browser (not the store app). */
export function cxoPixelHostAllowed(host: string | null | undefined, userAgent: string | null | undefined): boolean {
  if (process.env.SELFHOST === '1') return false
  return isCxoMarketingHost(host) && !isNativeAppUA(userAgent)
}

/**
 * The snippet from docs.whop.com/developer/ads/pixel, verbatim, scoped to the
 * Suite CXO business, wrapped in one guard (cxoPixelGuardJs: no GPC, no app or
 * company-host referrer). One line is added after the loader: `whop.c` is the
 * pixel's own start-up options (read by t.whop.tw/s.js when it boots; every
 * feature is on unless set to false):
 *   - autoPage:false: it does not track route changes by itself. We fire `page`
 *     on route changes (app/components/cxo/WhopPixel.tsx), only on allowed
 *     paths, so a visit is never counted twice and a non-selling page is never sent;
 *   - forms:false: it does not read email/name fields as they are typed (the
 *     sign-in email, an unsent form). We send contact details only with our
 *     own events, after the form is saved;
 *   - urlIdentity:false: it does not read email/name/phone from the query string.
 * Same settings as crmbuilds shared/whop-pixel.ts (Virtual Closer, Run My Ads).
 */
export function cxoWhopPixelSnippet(accountId: string = CXO_WHOP_PIXEL_ACCOUNT_ID): string {
  return `if(${cxoPixelGuardJs()}){
!function(w,d,s,u,n,a,b){if(w[n])return;a=w[n]={q:[],t:+new Date,s:[],o:u,track:function(){a.q.push([+new Date].concat([].slice.call(arguments)))},setScope:function(){a.s=[].slice.call(arguments).filter(function(x){return typeof x==="string"});a.q.push([+new Date,"setScope"].concat(a.s))},scope:function(){var c=[].slice.call(arguments);return{track:function(){a.q.push([+new Date].concat([].slice.call(arguments)).concat([{__scope:c}]))}}}};b=d.createElement(s);b.async=1;b.src=u+"/s.js";d.getElementsByTagName(s)[0].parentNode.insertBefore(b,d.getElementsByTagName(s)[0])}(window,document,"script","${WHOP_PIXEL_ORIGIN}","whop");
whop.c=Object.assign({},whop.c,{autoPage:false,forms:false,urlIdentity:false});
whop.setScope("${accountId}");
whop.track("page");
}`
}

/**
 * The guard the snippet runs first, in the browser (an expression, true = load).
 * s.js sends document.referrer with every event and the site sets no
 * Referrer-Policy, so a full load of /login from inside the app (a sign-out
 * reload, an idle timeout, a new tab) would hand Whop an app URL. The referrer
 * never changes for a document, so checking it once covers every later event.
 * Off when:
 *   - the browser sends Global Privacy Control (same as Virtual Closer / Run My Ads);
 *   - the referrer is on a company host (pinnacle.suitecxo.com and the rest);
 *   - the referrer is www.suitecxo.com / suitecxo.com on a path that is not a
 *     selling page (the app, /onboard/<token>, /reset-password ...);
 *   - the referrer cannot be read.
 * Outside referrers (Google, an ad) are fine. Compliance review 2026-10-22 (VC lane).
 */
function cxoPixelGuardJs(): string {
  const exact = JSON.stringify(PIXEL_PATHS_EXACT)
  const prefixes = JSON.stringify(PIXEL_PATH_PREFIXES)
  return `function(w,d){try{if(w.navigator&&w.navigator.globalPrivacyControl===true)return false;var r=d.referrer||"";if(!r)return true;var u=new URL(r),h=u.hostname.toLowerCase().replace(/\\.$/,"");if(h!=="suitecxo.com"&&!/\\.suitecxo\\.com$/.test(h))return true;if(h!=="suitecxo.com"&&h!=="www.suitecxo.com")return false;var p=u.pathname.replace(/\\/{2,}/g,"/").toLowerCase();if(p.length>1&&p.slice(-1)==="/")p=p.slice(0,-1);var e=${exact},x=${prefixes};if(e.indexOf(p)>=0)return true;for(var i=0;i<x.length;i++)if(p===x[i]||p.indexOf(x[i]+"/")===0)return true;return false}catch(err){return false}}(window,document)`
}

/** The `lead` event for one saved "Book a call" request. event_id is the prospect row's id. */
export function cxoLeadEvent(prospectId: string, contact?: { email?: string | null; name?: string | null }) {
  const out: { event_id: string; email?: string; name?: string } = { event_id: `cxo_lead_${prospectId}` }
  const email = (contact?.email ?? '').trim()
  const name = (contact?.name ?? '').trim()
  if (email) out.email = email
  if (name) out.name = name
  return out
}

/** A prospect id we put in the thank-you URL: a uuid, nothing else. */
export function safeProspectId(v: unknown): string | null {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v.toLowerCase() : null
}

/** sessionStorage key for the contact typed into the "Book a call" form, read once on the thank-you page. */
export const CXO_LEAD_CONTACT_KEY = 'cxo_lead_contact'
