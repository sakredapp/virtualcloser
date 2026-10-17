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
