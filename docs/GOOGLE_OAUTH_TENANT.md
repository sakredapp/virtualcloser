# Suite CXO: a company's own Google OAuth client

Owner ruling 2026-10-10. A company can run Ciao's Google connection (Gmail send,
Calendar) through an OAuth client created inside **its own Google Workspace**.
Because the consent screen is **Internal**, Google needs no app verification and
no CASA assessment for that company. Pinnacle is the first to set this up.

When a company has no client of its own, the global client on the Vercel project
(`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_OAUTH_REDIRECT_URI`) is used,
exactly as before. Nothing changes until an owner or admin saves a client.

## Where it lives

| Piece | Path |
| --- | --- |
| Storage | `reps.settings.google_oauth = { client_id, client_secret_enc, redirect_uri?, updated_at }` (JSONB; `supabase/cxo_tenant_google_client.sql` documents and indexes it) |
| Encryption | `lib/google.ts` `encryptGoogleSecret` / `decryptGoogleSecret`: AES-256-GCM, key = `GOOGLE_TOKEN_KEY` else derived from `SESSION_SECRET`. The secret is never logged and never returned to a browser. |
| Resolver | `lib/google.ts` `oauthClientFor(repId)`: the company's client when complete, else global. Used by the consent URL, the code exchange and every token refresh. |
| Save / clear / test | `lib/google/tenantClient.ts` |
| API | `app/api/google/client/route.ts` (GET masked view, PUT save, POST test connection, DELETE clear). Owner or admin on the tenant only. |
| Form | Integrations page → Google row → "Use your own Google client" (`app/dashboard/integrations/GoogleClientCard.tsx`). Shown to owners and admins only. |
| Staff view | `/admin/clients/[id]` has the same fields for our own team. |

"Test connection" sends one deliberately bad authorization code to Google's token
endpoint with the saved credentials. Google checks the client before the code, so
`invalid_client` means a wrong id/secret, `invalid_grant` means the pair is good,
`redirect_uri_mismatch` means the callback is not registered. Nothing is stored.

## Pinnacle set-up steps (their Google Workspace admin)

1. In [Google Cloud Console](https://console.cloud.google.com), create a project
   under the Pinnacle Workspace organisation (or reuse one). Enable the
   **Gmail API** and the **Google Calendar API**.
2. **APIs & Services → OAuth consent screen**: user type **Internal**. App name
   "Suite CXO" (Ciao is the assistant inside it), support email = their admin.
3. **Scopes**: add `https://www.googleapis.com/auth/gmail.send`,
   `https://www.googleapis.com/auth/calendar.events`,
   `https://www.googleapis.com/auth/calendar.readonly`. Ciao's connect flow also
   asks for `gmail.readonly`, `gmail.modify`, `calendar.freebusy`, `spreadsheets`
   and `drive.file` (see `GOOGLE_SCOPE` in `lib/google.ts`); on an Internal app
   these need no review, but if the Workspace admin restricts scopes, add them here.
4. **Credentials → Create credentials → OAuth client ID → Web application.**
   Authorized redirect URI: `https://suitecxo.com/api/google/oauth/callback`
   (the exact value is shown on the form; a tenant may set another host of ours).
5. Copy the client ID and secret. In Suite CXO, as owner/admin: **Settings →
   Integrations → Google → Use your own Google client**, paste, **Save**, then
   **Test connection**.
6. Each person on the team clicks **Connect Google** (or reconnects). From then
   on their tokens are issued by Pinnacle's client and refreshed with it.

## Everyone else (the public client)

Email send-as at scale for companies WITHOUT their own client needs Google's
CASA assessment on our public OAuth client. That is an owner purchase, not a
code change. Until then:

- marketing copy does not promise scaled email;
- the Amazon SES fallback (`lib/ses.ts`) stays coded but **OFF**: it needs
  `CXO_SES_FALLBACK=1` on top of the AWS variables, and none of them are set.

## Sign in with Google (2026-10-17)

A company with its own client (above) also gets a **Sign in with Google**
button on the Suite CXO login page. One click signs the person in AND connects
their Google, with the same scopes and storage as Connect Google.

- Shown when the login page names the company: on its own host
  (`mike.suitecxo.com/login`) or on the apex with a `next` on that host (the
  normal bounce from a company page). Plain `suitecxo.com/login` names no
  company and has no button.
- `/api/google/signin` (public, on the apex) signs a state
  `gsi.<payload>.<hmac>` holding the company, the login host, `next`, a nonce
  and a ten-minute expiry, and keeps the nonce in an httpOnly cookie
  (`cx_gsi`, path `/api/google/oauth/callback`). Code: `lib/google/signin.ts`.
- Google returns to the same registered callback. A `gsi.` state is checked
  (signature, expiry, nonce equals the cookie), the code is exchanged with the
  company's client, and the id_token must be for that client with
  `email_verified`. The email must match an ACTIVE member of THAT company,
  exactly (case-insensitive). No account is ever created; an unknown email
  goes back to the login page with "That Google account isn't on this team.
  Ask your admin to add you."
- Same session cookie as the password login. A member who was emailed a
  starting password and never signed in still goes to `/set-password` first;
  the agreement gate on the dashboard is unchanged.

## Connection health

`lib/google/tokenHealth.ts`, columns from `supabase/cxo_google_token_health.sql`
(`google_tokens.needs_reconnect`, `reconnect_reason`, `broken_at`).

- A refresh Google answers with `invalid_grant` (revoked, password change,
  six months unused), or an expired token with no refresh_token, flags the
  row. Calls to Google with that grant then stop until a reconnect.
- A calendar write refused for a missing scope (`reconnect_needed`) flags the
  row with reason `scope`; the token keeps being used.
- The false to true flip writes ONE in-app notice (`greconnect-` key, always
  shown; the Messages badge raises it as a browser notification) to that
  member, or to the owner for the company-level row. A row that keeps failing
  never sends a second one.
- The dashboard shows the Reconnect Google bar; Integrations shows each
  account as Connected or Needs reconnect.
- A connect, reconnect or Google sign-in (`saveTokens` with `consent: true`)
  clears the flag and marks the notice read. A background refresh never does.
  When Google returns no refresh_token on a reconnect, the old one is kept.

## Outside calendars (2026-10-17)

A company's own client is Internal at Google: it signs in that company's
accounts only. So on such a company, "Add another calendar" (Calendar page and
Integrations) offers two choices:

- **Another Pinnacle account**: the company's client, as before.
- **A calendar outside Pinnacle** (personal Gmail, another company): the
  Suite CXO app (else the GLOBAL client, see "Three Google apps"), asking for the calendar only (`GOOGLE_SCOPE_OUTSIDE_CALENDAR`:
  calendar.events, calendar.readonly, calendar.freebusy, openid, email; never
  gmail, drive or sheets). Link: `/api/google/oauth/start?add=1&outside=1`.
  The flag is honoured only when the company has its own client; the state
  carries `out` so the callback exchanges the code with the global client.

Companies without their own client keep the single button, unchanged.

Every stored connection records who issued it (`supabase/cxo_google_token_issuer.sql`):
`oauth_source` ('tenant' | 'global'), `oauth_client_id`, `calendar_only`.
Written on a consent only; a background refresh never changes them. Existing
rows were backfilled to 'global' (verified 2026-10-17: no company had its own
client saved yet).

- **Refresh** (`refreshClientsFor`): see "Three Google apps" below.
- **Revoke** needs no client (the token names its grant). A disconnect skips
  the revoke only when another kept row is the same account from the same
  client.
- **Never for mail**: mail, Drive and Sheets ask for a `'full'` token, which
  skips `calendar_only` rows; the mailbox picker (`computeMailboxScope`) leaves
  them out; Gmail sync already needs `gmail.readonly`, which they lack.
- **Same account twice**: an outside calendar for an account already connected
  as a company account is refused (`?gcal=same`), so a full grant is never
  swapped for a calendar-only one.
- **Labels**: Calendar "Manage" and Integrations show each account's email and
  "Pinnacle account" or "Outside calendar".
- **Health**: a broken outside calendar gets the same one notice ("Reconnect
  your calendar"); its Reconnect link goes through the outside path.
- The global client's redirect URI must land on a host carrying the Suite CXO
  session (suitecxo.com), the same as any company without its own client.

## Three Google apps (2026-10-17)

So a Suite CXO person no longer sees "continue to Virtual Closer" on Google's
screen, there are three OAuth apps. Each connection row records which one
issued it (`google_tokens.oauth_source` + `oauth_client_id`).

| Source | App | Keys | Scopes |
| --- | --- | --- | --- |
| `tenant` | The company's own Internal client (Pinnacle) | `reps.settings.google_oauth` | Full set, Gmail on the Pinnacle edition |
| `brand` | "Suite CXO" (External) | `GOOGLE_BRAND_CLIENT_ID` / `GOOGLE_BRAND_CLIENT_SECRET` (optional `GOOGLE_BRAND_REDIRECT_URI`, default `https://suitecxo.com/api/google/oauth/callback`) | NO Gmail: `GOOGLE_SCOPE_NO_GMAIL`, or calendar only for an outside calendar |
| `global` | "Virtual Closer" | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Full set |

- **New connection** (`oauthClientFor`): the company's own client → else the
  Suite CXO app (Suite CXO companies only, when both keys are set) → else global.
  Virtual Closer-brand tenants never get the Suite CXO app.
- **Outside calendar** on a company with its own client (`outsideCalendarClient`):
  the Suite CXO app → else global. Calendar scopes only.
- **Gmail**: `buildAuthUrl` never asks the Suite CXO app for Gmail, whatever
  the caller passes (and never sets `include_granted_scopes` for it).
- **Refresh** (`refreshClientsFor`): always the issuer. A stored
  `oauth_client_id` matching a known client wins; else `tenant` → the company's
  CURRENT client only (none = the person reconnects), `brand` → the Suite CXO
  app only, `global` → the Virtual Closer app only, legacy null → global, then
  the company's client. Existing rows (all `global`) keep refreshing with the
  Virtual Closer app untouched.
- **Revoke and token health** need no client: revoke ends the grant the token
  names, and an `invalid_grant` from any issuer flags the row the same way.
- **Database**: `supabase/cxo_google_token_issuer_brand.sql` widens the
  `oauth_source` check to allow `brand`. Until it runs, a brand row is stored
  without `oauth_source` and refreshes by its `oauth_client_id`.
- **Where the keys must be**: the Vercel project `suitecxo` (Production) AND
  the Hetzner worker's `.env.production` (pre-meeting briefs refresh tokens
  there). Without the keys on a host, brand-issued rows cannot refresh there.
