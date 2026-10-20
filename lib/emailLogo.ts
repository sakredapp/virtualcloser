/**
 * Light/dark logo swap for email headers (owner 2026-10-20: "just make it
 * white" — in a dark-mode email client the Suite CXO logo shows WHITE, with
 * no white box; light mode is unchanged).
 *
 * Pattern (Litmus "Ultimate Guide to Dark Mode"):
 *   - The light logo is the default <img class="cx-logo-light">.
 *   - The white logo sits next to it in a wrapper hidden inline
 *     (display:none; mso-hide:all), inside <!--[if !mso]> so Outlook desktop
 *     never sees it.
 *   - `@media (prefers-color-scheme: dark)` swaps them: Apple Mail, iOS Mail,
 *     Outlook for Mac, Hey, Thunderbird.
 *   - `[data-ogsc]` / `[data-ogsb]` swap them in Outlook.com and the Outlook
 *     apps, which mark the elements they darken with those attributes. These
 *     rules live in their own <style> block: Gmail drops a whole <style>
 *     block that holds a selector it does not understand.
 *   - Clients that support neither (Gmail web/iOS/Android, Yahoo) keep the
 *     light logo: black on its own white rectangle, readable on any ground.
 *
 * Every rule that shows the white logo must also make the ground behind it
 * dark in the same client, or the white logo would vanish on a white card.
 * Callers pass those rules in `darkCss`.
 */

export type EmailLogo = { src: string; width: number; height: number; darkSrc?: string }

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The two <img> tags: light shown by default, white shown only in dark mode. */
export function emailLogoHtml(logo: EmailLogo, alt: string, style: string): string {
  const light = `<img class="cx-logo-light" src="${esc(logo.src)}" alt="${esc(alt)}" width="${logo.width}" height="${logo.height}" style="${style}">`
  if (!logo.darkSrc) return light
  return `${light}<!--[if !mso]><!--><div class="cx-logo-dark" style="display:none;max-height:0;overflow:hidden;mso-hide:all;"><img src="${esc(logo.darkSrc)}" alt="${esc(alt)}" width="${logo.width}" height="${logo.height}" style="${style}"></div><!--<![endif]-->`
}

const SHOW_DARK = 'display:block !important;max-height:none !important;overflow:visible !important;'

/**
 * <meta> + <style> blocks for the <head>. `darkCss` is the rest of the email's
 * dark palette (card, text, borders), applied under the same conditions as
 * the white logo so the two never come apart.
 */
export function emailLogoDarkHead(darkCss = ''): string {
  const outlook = (css: string) =>
    css
      .split('}')
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => {
        const [sel, body] = r.split('{')
        const sels = sel.split(',').map((x) => x.trim()).filter(Boolean)
        return `${sels.flatMap((x) => [`[data-ogsc] ${x}`, `[data-ogsb] ${x}`]).join(',')}{${body}}`
      })
      .join('\n')
  const rules = `.cx-logo-light{display:none !important;}
.cx-logo-dark{${SHOW_DARK}}
${darkCss}`.trim()
  return `<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<style>
  :root{color-scheme:light dark;supported-color-schemes:light dark;}
  @media (prefers-color-scheme: dark){
${rules}
  }
</style>
<style>
${outlook(rules)}
</style>`
}
