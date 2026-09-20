# Virtual Closer Landing Page — Rebuild Brief

**Purpose.** Hand this to whoever/whatever rebuilds the Virtual Closer landing page. The goal is a **new page — new sections, new features, new copy — that is unmistakably the same brand.** Everything below is extracted from the real, shipped page (`app/page.tsx`, `app/globals.css`) as of July 2026.

Read §1 for the feel, §2–§8 for the exact values, §9 for what *not* to copy, §10 for the Telegram/CRM side note.

---

## 1. What the page looks like, in one paragraph

A **cream sheet of paper floating on a hot red background.** The red is never a backdrop you put text on — it's a **rim**, about 16px of signal-red showing around all four edges of a rounded cream card that holds the entire site. That cream card is outlined in a 1.5px near-black border with a **thin white ring drawn just inside it**, like a matted print or a letterpress plate. Inside, content alternates between **invisible cream bands** and **floating dark-grey gradient slabs** with big rounded corners, in a strict zebra rhythm with 120px of air between them. Every section opens the same way: a tiny **red all-caps kicker with very wide letter-spacing**, then a **heavy 900-weight headline with tight negative tracking**. Cards are red-outlined on a pale blush fill and **bloom a soft red glow** instead of a grey shadow. Everything is click-to-expand. It reads editorial and confident — expensive newsprint, not SaaS gradient soup.

**The three things that make it recognizable.** If a rebuild keeps only three, keep these:

1. **The red rim + inset white ring around the whole site.**
2. **The red uppercase kicker over a 900-weight tight headline**, on every section.
3. **Border color drives shadow color** — red-bordered things glow red.

---

## 2. Colorway

The visible canvas is `--paper-2` cream. The red body only shows as the rim. **All text on the canvas must be dark** — white text disappears.

| Token | Value | Role |
|---|---|---|
| `--red` | `#ff2800` | The signature. Kickers, borders, pills, CTAs |
| `--red-deep` | `#c21a00` | Hover/active |
| `--ink` | `#0f0f0f` | Primary text + hard borders |
| `--paper` | `#ffffff` | Card surface |
| `--paper-2` | `#f7f4ef` | **The visible canvas** (warm off-white) |
| `--muted` | `#2b2b2b` | Muted text |
| `--border-soft` | `#E5E5E5` | Default neutral card border |
| `--text-meta` | `#6B7280` | Labels/meta grey |
| `--signal-ok` | `#16a34a` | The ✓ bullets |

Plus two page-level values worth keeping:

```js
const DARK_GREY_GRADIENT = 'linear-gradient(135deg, #2a2a2a 0%, #161616 100%)'  // dark slabs
const MUTED_2 = '#525252'                                                        // footnotes/footer
const BLUSH   = '#fff5f3'                                                        // accent-card fill
```

**Dark tiles are neutral grey — never navy slate.** This is an explicit brand direction. (The current page violates it once; see §9.)

There is **no dark mode.** Single fixed light palette.

---

## 3. The inline border (the thing to get right)

A **double-border sandwich**: a 1.5px near-black border plus a **white 1px ring drawn inside it via inset box-shadow**, plus a barely-there outer halo. Three stacked edges.

```css
.site-shell {
  width: min(1296px, calc(100vw - 2rem));
  margin: 1rem auto;                    /* ← this margin is what reveals the red rim */
  padding: 1rem 1rem 1.55rem;
  background: var(--paper-2);
  border: 1.5px solid var(--ink);
  border-radius: 20px;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.68),  /* the inline ring */
    0 0 0 1px rgba(15, 15, 15, 0.03);           /* outer hairline halo */
}
```

with `html, body { background: var(--red); }` underneath.

**On mobile (≤720px) the frame is deleted entirely** — `border-width: 0; border-radius: 0; width: 100vw; margin: 0;`. The rim is a desktop luxury; on a phone it's wasted width.

**On dark surfaces the idea inverts:** the border becomes a faint white hairline, `1px solid rgba(255,255,255,0.08)`.

### Radius ladder — pick from this, don't invent

`999px` pill → `10px` CTA → `12px` neutral card → `14px` accent card → `18px` band → `20px` shell.

### Border widths

`1.5px` for structural things (shell, cards) · `2px` for CTAs · `1px` for `.card`, dashed dividers.

---

## 4. Shadows

```css
--shadow-card:    0 1px 3px rgba(15,15,15,0.04), 0 1px 2px rgba(15,15,15,0.04);
--shadow-card-lg: 0 8px 24px rgba(15,15,15,0.06), 0 2px 6px rgba(15,15,15,0.04);
```

**The rule: the shadow color matches the border color.**

- Red border → red bloom: `0 8px 32px rgba(255,40,0,0.16), 0 2px 6px rgba(255,40,0,0.12)`
- Neutral border → `var(--shadow-card)`
- Dark slab → `0 20px 48px rgba(15,15,15,0.22)`
- Primary CTA → `0 6px 18px rgba(255,40,0,0.30)`

Prefer the `--red-shadow-low/mid/high` tokens over hardcoding these rgba values (see §9).

---

## 5. Typography

**Barbell.** Display type is heavy with negative tracking. Micro type is bold, uppercase, with wide positive tracking. Body is plain. **Nothing in between** — there is no 600-weight middle ground, and that's the discipline.

| Role | Size | Weight | Tracking |
|---|---|---|---|
| Hero kicker | `0.78rem` | 800 | `0.2em` UPPER |
| Hero H1 | `clamp(2rem, 5vw, 2.8rem)` | **900** | `-0.02em` |
| Section kicker | `0.72rem` | 800 | `0.22em` UPPER |
| Section H2 | `clamp(1.6rem, 3.8vw, 2.2rem)` | **900** | `-0.015em` |
| Card title | `1.05rem` | 800 | — |
| Card tag pill | `0.68rem` | 800 | `0.16em` UPPER |
| Body / lead | `0.92–1.05rem` | 400 | — (line-height `1.65`) |
| Big number | `2.4rem` | **900** | `-0.02em` |

Font stack: `"IBM Plex Sans", "Inter", "Avenir Next", "Segoe UI", sans-serif`.

⚠️ **IBM Plex Sans is never actually loaded** — no `@font-face`, no `next/font`. The live page silently renders in Segoe UI / system sans. **A rebuild should either load it via `next/font` or write the stack it actually intends to ship.** Loading it for real will visibly change the page — that's a fix, not a regression, but expect it.

---

## 6. Layout & rhythm

```
body (red #ff2800)
└─ .site-shell   min(1296px, 100vw - 2rem), cream + ink border + inset ring
   └─ .wrap      min(1186px, 100%), padding: 9.5rem 0.45rem 2.25rem
      └─ sections
```

The `9.5rem` top padding is clearance for the absolutely-positioned corner logo (108px, inset 56px from the top-left; the actions menu mirrors it on the right).

**Spacing scale (8pt).** `--s-1:4 --s-2:8 --s-3:12 --s-4:16 --s-5:20 --s-6:24 --s-8:32 --s-10:40 --s-12:48 --s-16:64 --s-20:80 --s-24:96 --s-30:120 --s-40:160`

**Zebra rhythm.** Bands alternate dark → cream → dark → cream, `--s-30` (120px) apart on desktop, dropping to `--s-10` (40px) on mobile. Note the asymmetry — cream bands are *transparent* (just rhythm, no box) and pad `48px/8px`; dark bands are *visible slabs* and need interior room, padding `120px/40px`.

```jsx
// Cream — invisible, pure rhythm
<section style={{ marginTop: 'var(--s-30)', padding: 'var(--s-12) var(--s-2)' }}>

// Dark — a floating slab
<section style={{ marginTop: 'var(--s-30)', padding: 'var(--s-30) var(--s-10)',
  background: DARK_GREY_GRADIENT, color: '#fff', borderRadius: 18,
  boxShadow: '0 20px 48px rgba(15,15,15,0.22)' }}>
```

**Breakpoint: 720px.** Use it consistently (the current page also uses 900/560 in one spot — don't).

**Grids.** 2×2 for feature rows, 3-col for benefit grids, `repeat(auto-fit, minmax(300px, 1fr))` for card pairs. Gap `1.4rem`. All collapse to 1 column at 720px.

---

## 7. Component patterns

### Section opener — use on every band
```jsx
<div style={{ textAlign: 'center', marginBottom: '2rem' }}>
  <p style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.22em',
      textTransform: 'uppercase', color: BRAND_RED, margin: 0 }}>{kicker}</p>
  <h2 style={{ fontSize: 'clamp(1.6rem, 3.8vw, 2.2rem)', color: tone === 'dark' ? '#fff' : INK,
      margin: '0.7rem auto 0', fontWeight: 900, letterSpacing: '-0.015em',
      lineHeight: 1.2, maxWidth: 780 }}>{children}</h2>
</div>
```
**The red kicker stays red on both cream and dark bands.** It's the one constant.

### Primary CTA
```js
{ background: BRAND_RED, color: '#fff', border: `2px solid ${BRAND_RED}`,
  padding: '0.7rem 1.4rem', borderRadius: 10, fontWeight: 800, fontSize: '0.95rem',
  letterSpacing: '0.02em', boxShadow: '0 6px 18px rgba(255,40,0,0.30)' }
```

### Secondary CTA — same border, 10% red fill, ink text, no glow
```js
{ background: 'rgba(255,40,0,0.10)', color: INK, border: `2px solid ${BRAND_RED}`,
  padding: '0.7rem 1.4rem', borderRadius: 10, fontWeight: 800, fontSize: '0.95rem' }
```

### Accent card — blush fill, red outline, red bloom
```js
{ background: '#fff5f3', border: '1.5px solid #ff2800', borderRadius: 14,
  boxShadow: '0 8px 32px rgba(255,40,0,0.16), 0 2px 6px rgba(255,40,0,0.12)',
  overflow: 'hidden' }
```

### Neutral card
```js
{ background: '#fff', border: '1.5px solid #e6e1d8', borderRadius: 12,
  boxShadow: 'var(--shadow-card)', overflow: 'hidden' }
```

### Tag pill
```js
{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase',
  background: BRAND_RED, color: '#fff', padding: '4px 10px', borderRadius: 999 }
```

### Checkmark bullet
```jsx
<li style={{ fontSize: '0.92rem', color: INK, display: 'flex', alignItems: 'baseline',
    gap: 10, lineHeight: 1.65 }}>
  <span aria-hidden style={{ color: 'var(--signal-ok)', fontWeight: 700, flexShrink: 0 }}>✓</span>
  <span>{text}</span>
</li>
```

### Collapsible card — native `<details>`, no JS
Every card on the page expands. The whole landing page is a **server component with zero client JS**.

```css
details[open] > summary .chevron { transform: rotate(180deg); }
details > summary::-webkit-details-marker { display: none; }
details > summary::marker { display: none; }
```
Plus `listStyle: 'none'; cursor: pointer; userSelect: 'none'` on the `<summary>`, `overflow: hidden` on the `<details>` so the body clips to the radius, a `▼` glyph with `transition: transform 160ms ease`, and a `1px dashed` divider between summary and body.

**Alignment trick:** give the summary `<h3>` a fixed `minHeight: '2.6rem'` so collapsed cards in a row line up flush regardless of title length.

---

## 8. The old page's sections (for reference — **do not reproduce these**)

Listed only so the rebuild can tell what's *structure* from what's *content*. The new page should have its own sections.

| # | Section | Tone |
|---|---|---|
| 1 | Hero — kicker, 900-weight H1, lead, two CTAs. No card. | canvas |
| 2 | Four AI hires — 2×2 accent cards | **dark** |
| 3 | Cost compare — human column vs. AI column, "vs." between | cream |
| 4 | Integrations — 2×2 neutral cards | **dark** |
| 5 | Why it scales — 3-col, six numbered benefit cards | cream |
| 6 | Two paths — individuals vs. enterprise | **dark** |
| 7 | Origin story — single dark prose card | cream |
| 8 | Footer — © · Privacy · Terms · email | canvas |

**The transferable structure** is: *hero (no card) → alternating bands, each opening with kicker+H2 → a grid or comparison inside each → dark prose card near the end → thin footer.* Fill it with whatever the new page needs.

Gating: the route is a server component that reads `x-tenant-host`/`host` and redirects to `/dashboard` unless the host is a gateway (apex/www/localhost/vercel.app). Keep that.

---

## 9. Known flaws — fix these, don't inherit them

The current page accumulated these over ~16 commits. A rebuild is the chance to drop them.

- **Tokens are duplicated as page constants.** `BRAND_RED`/`INK`/`MUTED` shadow the real `--red`/`--ink`/`--muted` CSS vars, so the landing page **cannot brand-switch** (it stays red under the CXO theme). Use `var()` if multi-brand ever matters.
- **`#0f172a` navy pills** on the integrations cards directly contradict the "neutral grey, not navy slate" brand direction.
- **Three different dashed-divider colors** (`#e2dccd` / `#f3d6cf` / `#ece6da`) where one would do.
- **Dead tokens.** `--red-shadow-low/mid/high` and `--signal-ok` exist but the page hardcodes their values instead.
- **Two CTA systems on one page** — inline 10px-radius buttons in the hero vs. 999px `.btn` pills further down. Pick one.
- **Mismatched breakpoints** — 900/560 for one grid, 720 everywhere else.
- **Duplicate `.landing-hero` mobile rule** — an inline `<style>` silently overrides `globals.css` at the same breakpoint. Confusing; the globals rule is effectively dead.
- **IBM Plex Sans is never loaded** (see §5).
- **No Tailwind config.** Tailwind v4 is installed but `globals.css` only imports `tailwindcss/utilities`, at the bottom, with no preflight and no `@theme`. The landing page uses **zero Tailwind classes** — it's inline styles + a few hand-written classes. Don't assume Tailwind tokens exist.

---

## 10. Side note — how the Telegram bot reads the CRM

Included because the landing page's origin-story section talks about "Jarvis on Telegram," and because you'll likely want to adapt this flow into the new build.

### ⚠️ Status as of this change: the Virtual Closer bot is retired *from this codebase*

The VC bot (`@VirtualCloserBot` / `TELEGRAM_BOT_TOKEN`) now belongs to a **separate CRM product outside this repo**. This application no longer sends as it or acts on its updates. Enforced in two independent places:

1. `virtualcloser.telegram.enabled = false` in `lib/brand.ts` → `brandTelegramToken('virtualcloser')` returns `undefined` → every sender in `lib/telegram.ts` no-ops.
2. `app/api/telegram/webhook/route.ts` is an inert stub that parses nothing and returns 200.

**Do not call `deleteWebhook` on the VC bot.** A bot has exactly one webhook URL, and that registration belongs to the other CRM now. Deleting it breaks *their* product.

**The live bot is CXO Suite** (`@SuiteCxObot` / `CXO_TELEGRAM_BOT_TOKEN`) at `app/api/telegram/cxo/webhook/route.ts`. Everything below describes that bot — the architecture is unchanged, only the brand it speaks as.

### The read path, end to end

**1 — Identity.** `members.telegram_chat_id` is the key to everything.

```ts
// lib/telegram-webhook.ts → findTenantByChatId()
const { data: m } = await supabase.from('members').select('*')
  .eq('telegram_chat_id', String(chatId)).eq('is_active', true).maybeSingle()
// → then reps by member.rep_id
```
chat_id → member → `rep_id` (the tenant). **No chat_id binding = no CRM access.** Binding is one-chat-one-member: binding a chat clears it off any other member first.

**2 — Context.** Loads ~40 recent lead names (for fuzzy matching) plus 40 rows of `agent_history` keyed by `member_id`.

**3 — The agent loop (this is the primary path).** `lib/agent/runAgent.ts` runs an Anthropic tool-calling loop, dispatching `TOOL_HANDLERS` until the model stops asking for tools.

> **Intent is not parsed up front — the model picks its own read tools.** There's no intent classifier in front. This is the single most important thing to understand before adapting it.

Read tools live in `lib/agent/tools.ts`: `who_am_i`, `list_leads`, `list_calendar_events`, `list_recent_calls`, `get_call_stats`, `list_targets`, `list_members`, `list_pipeline_boards`, `list_pipeline_leads`, `list_kpi_history`, `list_brain_items`, `list_deferred_items`, `list_roleplay_sessions`, `list_dialer_calls`, `pinnacle_revenue`, `payroll`.

**4 — The query.** Everything bottoms out here:

```ts
// lib/supabase.ts
export async function getAllLeads(repId: string, scope?: ReadScope): Promise<Lead[]> {
  let q = supabase.from('leads').select('*').eq('rep_id', repId)
        .order('updated_at', { ascending: false })
  q = applyOwnerScope(q, scope)   // row visibility by owner_member_id / managed team
```

Two things to note:
- **Tenant isolation is `.eq('rep_id', repId)` in application code — not RLS.** Every new read path must do this itself. Nothing at the database layer will catch a mistake.
- **`list_leads` fetches *all* leads then filters in JS.** Fine at current scale, a problem later.

**5 — Fallback.** If the agent returns low signal or errors, a legacy NLU parser (`interpretTelegramMessageDeep` in `lib/claude.ts`) emits structured `TelegramIntent[]` into a ~43-case `executeIntent` switch. Consider this deprecated — it exists as a safety net.

**Tables read:** `members`, `reps`, `leads`, `agent_history`, `brain_items`, `brain_dumps`, `calls`, `targets`, `pipeline_stages`, `kpi_cards`, `kpi_entries`, `roleplay_sessions`, `voice_calls`, `meetings`, `deferred_items`, `rooms`.

**External CRMs (GHL, Sheets) are write/sync-only from Telegram** — they are not part of the read path. `lib/crmLeads.ts` is **not imported by Telegram at all**; it's dashboard-only.

### If you adapt this

- **The surface to change is `lib/agent/tools.ts`**, not `lib/crmLeads.ts`. Adding a capability means adding a tool, not editing the dispatcher.
- **Always scope by `rep_id`** — isolation is app-level.
- Outbound sends resolve their bot from `AsyncLocalStorage` (`runWithBrand`), so anything called inside a webhook request automatically uses the right token. **Outside a request (crons, jobs), pass `{ brand }` explicitly.**
- A Telegram `file_id` is only resolvable **by the bot that received it** — voice handling must use the matching token. (`lib/transcribe.ts` and `lib/voice-memos.ts` used to read the VC token raw regardless of brand; both are now brand-aware.)
- A bot can only message a user who has started a chat with *that* bot. Members migrating from the VC bot must open `@SuiteCxObot` before sends to them will land — the codebase already stamps `settings.cxo_bot_connected` on first contact to drive a dashboard prompt.
