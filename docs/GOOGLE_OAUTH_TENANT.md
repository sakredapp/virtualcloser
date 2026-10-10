# Suite CXO: a company's own Google OAuth client

Owner ruling 2026-10-10. A company can run Mira's Google connection (Gmail send,
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
   "Mira" (or their own choice), support email = their admin.
3. **Scopes**: add `https://www.googleapis.com/auth/gmail.send`,
   `https://www.googleapis.com/auth/calendar.events`,
   `https://www.googleapis.com/auth/calendar.readonly`. Mira's connect flow also
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
