// Pure-text constants + HTML renderer for the AI Dialer liability
// agreement. No DB / supabase dependency — safe to import from client
// components (the demo "View liability terms" button + the in-dashboard
// LiabilityGate modal both render directly from this file).
//
// Persistence (recordSignature, listAgreementsForRep, signed-URL
// helpers) lives in lib/liabilityAgreement.ts and pulls these constants
// from here.

export const CURRENT_VERSION = '2026-04-30-v1' // TODO_LEGAL: bump on material edits

export const AGREEMENT_TITLE = 'AI Dialer Service — Liability Agreement'

/**
 * The full agreement body in markdown-ish prose. Rendered as HTML for the
 * sign modal + email + audit snapshot, and stored as `agreement_text` on
 * each signature row so we always have the verbatim copy the member
 * agreed to.
 *
 * TODO_LEGAL: replace with attorney-reviewed copy before launch.
 */
export const AGREEMENT_BODY = `
**Effective version:** ${CURRENT_VERSION}

## 1. Service we provide
Virtual Closer ("the Platform") provides an AI-powered outbound dialer
that places automated voice calls on your behalf. We supply the
dialer, the AI voice agent, the call routing, and the dashboard. We
do not select your leads, write your scripts, or place calls
without your direction.

## 2. Compliant use — your responsibility
By signing this agreement you confirm that you will:

- **Disclose the AI.** State that the call is being placed by an
  artificial-intelligence agent, on every call, in every state. The
  Platform recommends disclosure regardless of whether your state
  legally requires it (some do, some don't, the safest stance is
  always disclose).
- **Announce recording.** State that the call is being recorded at
  the start of the call. Some jurisdictions are two-party consent
  (CA, FL, IL, MD, MA, MT, NH, PA, WA among others) and require
  this; the Platform recommends announcing on every call regardless.
- **Honor opt-outs immediately.** If a contact says "stop calling"
  or "do not call," remove them from your dialer queue at once and
  add them to your suppression list.
- **Comply with TCPA + state DNC + CAN-SPAM** and all other
  applicable consumer-protection laws covering outbound voice calls
  in the jurisdictions you call into.
- **Never call numbers on the National Do Not Call Registry** or any
  state DNC registry without an established business relationship or
  prior express written consent.
- **Never use the dialer for fraud, harassment, scams, illegal
  collections, political robocalls without proper registration, or
  any other prohibited purpose.**

## 3. Liability — yours, not ours
You acknowledge and agree that:

- **You** are the calling party of record for every call placed
  through the Platform on your behalf. **You** select the contacts,
  approve the scripts, and direct the timing.
- **You** are solely liable for any call placed through your
  account, including calls placed by AI SDRs operating within hour
  budgets and shifts you configured.
- **You release, indemnify, and hold harmless** the Platform, its
  operators, employees, contractors, and affiliates from any and
  all claims, lawsuits, fines, regulatory actions, settlements, or
  damages arising from your use or misuse of the AI dialer
  service — including but not limited to TCPA violations, state DNC
  violations, recording-disclosure failures, CAN-SPAM violations,
  and any third-party complaints related to calls placed through
  your account.
- **The Platform is not a party** to any communication you originate
  via the service and **shall not be named as a defendant or
  co-defendant** in any action arising from those communications.
- **The Platform may suspend or terminate** your AI dialer access
  immediately and without refund if it has reason to believe you
  are in violation of this agreement or applicable law.

## 4. Recording, storage, and data
- Calls placed through the dialer are recorded and transcribed for
  your benefit (call review, training, dispute resolution).
- Recordings are stored on Platform infrastructure for as long as
  your account remains active, plus a 30-day retention buffer after
  termination.
- You may request deletion of specific recordings at any time.

## 5. Service availability
The Platform provides best-effort uptime but does not guarantee any
specific service level for the AI dialer. The Platform may pause the
dialer for routine maintenance, vendor migrations, or in response to
suspected misuse without notice.

## 6. Acceptance
By typing your full legal name and clicking "I agree and sign," you
acknowledge you have read this agreement in full, understand it,
have the authority to bind yourself (and your organization, where
applicable) to its terms, and accept all responsibilities described
above.

A signed PDF copy will be emailed to you and stored on your account
for both you and Platform staff to retrieve at any time.
`.trim()

/**
 * Render the agreement to standalone HTML — used for the in-app modal
 * preview, the email body, and the audit snapshot uploaded to storage.
 */
export function renderAgreementHtml(args: {
  signatureName?: string
  signedAt?: string
  workspaceLabel?: string
}): string {
  const sigBlock = args.signatureName
    ? `<div style="border:1px solid #d4d4d4;border-radius:8px;padding:14px 18px;margin-top:24px;background:#fafafa;">
         <p style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#525252;">Signed by</p>
         <p style="margin:0;font-size:18px;font-weight:600;color:#0f172a;">${escapeHtml(args.signatureName)}</p>
         ${
           args.signedAt
             ? `<p style="margin:4px 0 0;font-size:12px;color:#525252;">on ${escapeHtml(args.signedAt)}</p>`
             : ''
         }
         ${
           args.workspaceLabel
             ? `<p style="margin:2px 0 0;font-size:12px;color:#525252;">workspace: ${escapeHtml(args.workspaceLabel)}</p>`
             : ''
         }
       </div>`
    : ''

  const html = AGREEMENT_BODY
    .split('\n\n')
    .map((para) => {
      const trimmed = para.trim()
      if (trimmed.startsWith('## ')) {
        return `<h2 style="font-size:16px;color:#0f172a;margin:28px 0 8px;font-weight:700;">${escapeHtml(trimmed.slice(3))}</h2>`
      }
      if (trimmed.startsWith('- ')) {
        const items = trimmed
          .split('\n')
          .filter((l) => l.startsWith('- '))
          .map((l) => `<li style="margin-bottom:6px;">${renderInline(l.slice(2))}</li>`)
          .join('')
        return `<ul style="margin:8px 0 14px;padding-left:20px;color:#1f2937;font-size:13px;line-height:1.55;">${items}</ul>`
      }
      return `<p style="margin:8px 0 14px;color:#1f2937;font-size:13px;line-height:1.6;">${renderInline(trimmed)}</p>`
    })
    .join('')

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(AGREEMENT_TITLE)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 720px; margin: 32px auto; padding: 0 24px; color:#0f172a;">
  <h1 style="font-size:22px;margin:0 0 4px;">${escapeHtml(AGREEMENT_TITLE)}</h1>
  <p style="font-size:12px;color:#64748b;margin:0 0 18px;">Version ${escapeHtml(CURRENT_VERSION)}</p>
  ${html}
  ${sigBlock}
</body>
</html>`
}

function renderInline(text: string): string {
  const safe = escapeHtml(text)
  return safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
