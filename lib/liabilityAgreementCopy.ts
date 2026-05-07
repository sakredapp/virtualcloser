// Pure-text constants + HTML renderer for the AI Dialer liability
// agreement. No DB / supabase dependency — safe to import from client
// components (the demo "View liability terms" button + the in-dashboard
// LiabilityGate modal both render directly from this file).
//
// Persistence (recordSignature, listAgreementsForRep, signed-URL
// helpers) lives in lib/liabilityAgreement.ts and pulls these constants
// from here.

export const CURRENT_VERSION = '2026-05-06-v3'

export const AGREEMENT_TITLE = 'Virtual Closer — Operational & Liability Agreement'

/**
 * Full agreement body — stored verbatim as `agreement_text` on each
 * signature row so we always have the exact copy the member agreed to.
 */
export const AGREEMENT_BODY = `
**Effective version:** ${CURRENT_VERSION}

---

## 1. Parties and Service Description

Virtual Closer ("the Platform," "we," "us") provides an AI-powered outbound voice dialer, AI roleplay trainer, appointment-confirmation agent, and related sales-automation tools accessible through the Virtual Closer dashboard (collectively, "the Service").

By activating your account and signing this agreement you authorize the Platform to place automated, AI-generated voice calls to contacts you supply, using the AI voice infrastructure, call routing, and billing system we manage. You ("Client," "you," "your") are the business or individual directing those calls. You select the contacts, control the scripts and AI agent configurations, and determine when and how the dialer operates on your behalf. **We do not originate calls for our own commercial purpose; every call placed through your account is placed at your direction and under your authority.**

---

## 2. AI Disclosure — Federal and State Requirements

Federal law and a growing number of state statutes require callers to identify when a call is made by or includes an artificial-intelligence voice agent. **The law in this area is changing rapidly and varies significantly by jurisdiction.** The summary below reflects requirements known as of this agreement's effective date. **It is your sole responsibility — not the Platform's — to verify current legal requirements in every jurisdiction you call into and to update your scripts and practices accordingly. This agreement does not constitute legal advice.**

**Federal:** The FTC Act (15 U.S.C. § 45) prohibits unfair or deceptive acts. Using a synthetic or AI-generated voice without disclosure may constitute a deceptive practice under FTC precedent. The FCC has ruled that AI-generated voices used in robocalls are subject to the same TCPA restrictions as prerecorded messages.

**California (AB 2602, effective January 1, 2025; SB 1228):** Requires any person using a synthetic or AI-generated voice in a phone call or voice message for commercial, political, or solicitation purposes to clearly and conspicuously disclose at the outset that the voice is artificial or AI-generated. Failure to comply may expose you to civil liability and regulatory action by the California Attorney General or private plaintiffs. California's Invasion of Privacy Act (CIPA, Penal Code § 632) additionally requires all-party consent for recording.

**Illinois:** The Artificial Intelligence Video Interview Act (820 ILCS 42) covers AI in hiring contexts. Broader AI transparency legislation is under active consideration by the Illinois General Assembly. Illinois is also an all-party consent state for telephone recording (720 ILCS 5/14-2). Monitor developments closely before calling Illinois numbers.

**Washington (HB 1170 / SB 5116):** Washington has enacted broad AI governance measures and is an all-party consent state for recording (RCW 9.73.030). Pending legislation may impose explicit AI-disclosure obligations for commercial calls. Verify current law before calling Washington numbers.

**Colorado (CRS § 6-1-1301 et seq., Colorado AI Act):** Requires developers and deployers of high-risk AI systems to exercise reasonable care to protect consumers from algorithmic discrimination. Commercial AI calling may trigger disclosure and consumer-rights obligations under this framework. Colorado is a one-party consent state for recording.

**Texas:** No specific AI-voice disclosure statute is in force as of this agreement's effective date, but the Texas Deceptive Trade Practices Act (DTPA, Tex. Bus. & Com. Code § 17.41) prohibits deceptive business practices and may apply to undisclosed AI impersonation. Texas is a one-party consent state for recording. Verify current status before calling.

**Florida:** Florida SB 262 (Digital Bill of Rights) creates consumer rights around AI-generated content. Florida is an all-party consent state for telephone recording (Fla. Stat. § 934.03). Disclosure of both the AI nature of the call and the recording is required.

**Other All-Party Consent States (recording disclosure required):** Connecticut, Delaware, Maryland, Massachusetts, Michigan, Montana, Nevada, New Hampshire, Oregon, and Pennsylvania. In all of these states you must announce at the start of each call that it will be recorded. Calling without such an announcement may constitute a criminal wiretapping violation.

**Your ongoing duty:** You must ensure that every AI voice call placed through the Platform includes a clear, prominent AI disclosure in the first several seconds of the interaction — regardless of whether your state or the recipient's state currently mandates one. The Platform's default AI agent templates include a recommended disclosure line. **Removing or weakening that disclosure does not transfer any liability to the Platform.**

---

## 3. Telephone Consumer Protection Act (TCPA)

The TCPA (47 U.S.C. § 227) is the primary federal statute governing automated and AI-generated telephone calls.

- **Prior Express Written Consent:** You may not use the Platform to deliver a prerecorded or AI-generated voice message to any wireless number, or to any residential line using an automatic telephone dialing system (ATDS), without the recipient's prior express written consent — unless a recognized statutory exemption applies. Consult qualified legal counsel for exemption analysis.
- **Established Business Relationships (EBR):** An EBR is not a substitute for TCPA consent for wireless numbers. An EBR may provide a narrower exemption for certain residential-landline calls; consult counsel.
- **Time Restrictions:** Federal regulations (47 C.F.R. § 64.1200(c)(1)) and the FTC's Telemarketing Sales Rule (16 C.F.R. § 310.4(c)) restrict outbound telemarketing calls to 8:00 a.m.–9:00 p.m. in the recipient's local time zone. You must configure the Platform's dialer shifts to honor this window.
- **Caller-ID Accuracy:** You must ensure the caller-ID transmitted with every call accurately identifies you or your organization. Spoofing caller-ID in a misleading manner violates the Truth in Caller ID Act (47 U.S.C. § 227(e)).
- **Per-Violation Liability:** The TCPA provides statutory damages of $500 per negligent violation and $1,500 per willful violation with no ceiling on aggregate class-action exposure. You are the "caller" of record and bear this exposure entirely.

---

## 4. Do-Not-Call (DNC) Compliance

- You must never call numbers registered on the National Do Not Call Registry (donotcall.gov) without a valid EBR or prior express written consent post-dating the DNC registration.
- You must maintain a company-specific DNC list and process opt-out requests within 30 days of the request (FTC Safe Harbor standard); many states require immediate or shorter processing windows.
- **State DNC registries** exist in Indiana, Louisiana, Montana, Tennessee, Texas, Wyoming, and others. A number may appear only on a state registry, not the national one. You are responsible for scrubbing against all applicable registries.
- The Platform's suppression-list feature is a convenience tool and does not substitute for your own compliance program. You are solely responsible for ensuring your uploaded lead lists are DNC-clean before activation.

---

## 5. Prohibited Uses

You may not use the Platform or any Service feature to:

- Call any number without the required level of prior consent.
- Impersonate a government agency, law enforcement, financial institution, or any other entity in a misleading manner.
- Engage in fraud, threats, intimidation, or unlawful harassment.
- Conduct illegal debt collection or offer illegal financial products or services.
- Place political robocalls or survey calls without all required FCC and state registrations and approvals.
- Circumvent the Platform's built-in compliance safeguards, including but not limited to disabling or modifying AI disclosure prompts or manipulating caller-ID.
- Scrape, harvest, or source lead data in violation of applicable law or a third party's terms of service.
- Re-sell, sub-license, or share Platform access with unauthorized third parties.

---

## 6. Your Duty to Research and Monitor Applicable Law

The legal framework for AI-powered voice calling is one of the fastest-changing areas of technology law. New federal regulations, FCC orders, state statutes, and court decisions appear regularly. **You acknowledge and agree that:**

- The Platform does not provide legal advice, and nothing in this agreement should be construed as legal advice.
- It is your sole responsibility to retain qualified legal counsel and to continuously monitor developments in federal law (TCPA, FTC Act, FCC regulations, E-SIGN Act) and in the laws of every state and jurisdiction into which you call.
- Compliance obligations vary by the recipient's location, the nature of your business, the content of your calls, and how the call is initiated.
- Changes in applicable law after this agreement's effective date do not reduce your compliance obligations — they may increase them. The Platform is not obligated to notify you of legal changes.
- **If you are uncertain whether a particular calling or AI-use practice is lawful, do not proceed until you have obtained written advice from a licensed attorney in the relevant jurisdiction.**
- The Platform may, at its discretion, implement technical safeguards designed to reduce compliance risk, but the existence of such safeguards does not relieve you of any legal obligation.

---

## 7. Liability, Indemnification, and Hold Harmless

**7.1 You are the calling party of record.** Every call placed through the Platform originates at your direction. For all purposes under the TCPA, FCC regulations, state telecommunications law, state consumer-protection law, and any other applicable statute or regulation, **you** are the "seller," "telemarketer," "caller," "operator," or equivalent regulated party. The Platform is the technology conduit.

**7.2 Full indemnification.** You agree to defend, indemnify, and hold harmless Virtual Closer and its officers, directors, members, employees, contractors, agents, successors, and assigns (collectively, "the Platform Parties") from and against any and all losses, liabilities, damages, claims, demands, lawsuits, administrative proceedings, regulatory investigations, fines, penalties, statutory damages, compensatory damages, punitive damages, settlements, attorneys' fees, court costs, and expert-witness fees (collectively, "Losses") arising out of or related to:

(a) your use or misuse of the Platform or any feature of the Service;
(b) any call, message, or communication placed or sent through your account;
(c) your failure to obtain legally required consents from call recipients;
(d) your violation of the TCPA, FCC regulations, FTC rules, the Truth in Caller ID Act, any state telemarketing statute, any state recording or wiretapping law, any state AI-disclosure requirement, any state privacy law, or any other applicable law or regulation;
(e) the content of your AI call scripts, including any misrepresentation or disclosure failure;
(f) your contact-list sourcing, DNC-scrubbing, or data-handling practices; or
(g) any third-party claim that your use of the Service infringed upon their rights.

**7.3 No Platform liability for call outcomes.** The Platform Parties shall have no liability whatsoever for any Losses arising from calls you originate, including without limitation TCPA class-action exposure, state attorney-general enforcement, private tort claims, or reputational damage.

**7.4 Consequential-damages waiver.** To the maximum extent permitted by applicable law, in no event shall the Platform Parties be liable for any indirect, incidental, special, consequential, exemplary, or punitive damages — including lost profits, loss of business, loss of data, or reputational harm — arising out of or related to this agreement or the Service, even if advised of the possibility of such damages.

**7.5 Platform liability cap.** If a court of competent jurisdiction holds that the Platform Parties bear liability notwithstanding the provisions above, that liability is capped at the total fees you paid to the Platform in the three (3) calendar months immediately preceding the event giving rise to the claim.

**7.6 Right to suspend or terminate.** The Platform may suspend or permanently terminate your Service access immediately and without refund if it has reasonable grounds to believe you are in violation of this agreement, applicable law, or the rights of any third party.

---

## 8. Data, Recordings, and Privacy

- Calls placed through the Platform are recorded and transcribed as part of the Service for your benefit (quality review, coaching, dispute resolution) and stored on Platform-managed infrastructure.
- Call recordings and transcripts are retained while your account is active and for 30 days following account termination. You may request deletion of specific recordings at any time by contacting support.
- You are solely responsible for ensuring that your collection, storage, use, and disclosure of contact data (names, phone numbers, email addresses, call recordings, transcripts, and any other personal information) complies with all applicable privacy and data-protection law, including but not limited to the California Consumer Privacy Act / CPRA (CCPA, Cal. Civ. Code § 1798.100 et seq.), the Florida Digital Bill of Rights, the Colorado Privacy Act, the Virginia Consumer Data Protection Act, and the EU/UK GDPR where applicable.
- The Platform does not sell, share for cross-context behavioral advertising, or otherwise commercially exploit your contact data or call recordings to third parties outside the scope of providing the Service.
- You represent that you have a lawful basis under applicable privacy law to provide contact data to the Platform for the purpose of automated dialing.

---

## 9. Service Availability

The Platform provides best-effort uptime but makes no warranty of uninterrupted or error-free service. The Platform may pause or limit the AI dialer for scheduled maintenance, vendor migrations, carrier restrictions, or in response to suspected misuse. No service-level agreement (SLA) is implied or provided unless separately executed in writing between the parties.

---

## 10. Termination

Either party may terminate this agreement upon written notice. The Platform may terminate immediately and without prior notice for any material breach, including any violation of Sections 2 through 6 above or any conduct that exposes the Platform to legal, regulatory, or reputational risk. Sections 2, 6, 7, 8, 11, and 12 survive any termination or expiration of this agreement.

---

## 11. Governing Law and Dispute Resolution

This agreement is governed by the laws of the State of Florida without regard to conflict-of-law principles. Any dispute that cannot be resolved by good-faith negotiation within 30 days shall be submitted to binding arbitration under the American Arbitration Association (AAA) Commercial Arbitration Rules, seated in Miami-Dade County, Florida. The prevailing party shall be entitled to recover reasonable attorneys' fees and costs. Notwithstanding the foregoing, the Platform may seek injunctive or other equitable relief in any court of competent jurisdiction to prevent or remedy irreparable harm.

---

## 12. Entire Agreement; Amendments; Severability

This agreement, together with the Platform's Terms of Service and Privacy Policy (both incorporated herein by reference), constitutes the entire agreement between the parties regarding AI dialer liability and supersedes all prior representations, discussions, or understandings on this subject. If any provision is held invalid or unenforceable, that provision shall be modified to the minimum extent necessary to make it enforceable, and the remaining provisions shall remain in full effect. The Platform reserves the right to amend this agreement; any material amendment will require a new electronic signature before continued access to the Service.

---

## 13. Acceptance and Electronic Signature

By typing your full legal name in the signature field and clicking "I agree and sign," you:

(a) confirm that you have read this agreement in its entirety and fully understand its terms;
(b) represent that you have the legal authority to bind yourself and, where applicable, your organization to these terms;
(c) agree that your typed name constitutes a legally binding electronic signature under the Electronic Signatures in Global and National Commerce Act (E-SIGN Act, 15 U.S.C. § 7001 et seq.) and the Uniform Electronic Transactions Act (UETA), and carries the same legal weight as a handwritten signature; and
(d) accept all compliance obligations, liability allocations, and other responsibilities described in this agreement, effective immediately as of the date and time recorded in the signature block below.

A confirmed copy of this signed agreement will be emailed to you and archived on your account for retrieval by you and Platform staff at any time.
`.trim()

/**
 * Render just the agreement body paragraphs as embeddable HTML (no html/body
 * wrapper, no signature block). Used by the onboarding sign page so it can
 * embed the content inside its own document card and append its own sign UI.
 */
export function renderAgreementBodyFragment(): string {
  return renderBodyHtml()
}

/**
 * Render the agreement to standalone HTML — used for the in-app modal
 * preview, the email body, and the audit snapshot uploaded to storage.
 */
export function renderAgreementHtml(args: {
  signatureName?: string
  signedAt?: string
  workspaceLabel?: string
  ipAddress?: string
}): string {
  const sigBlock = args.signatureName
    ? `<div style="border:2px solid #0b1f5c;border-radius:10px;padding:20px 24px;margin-top:32px;background:#f0f4ff;">
         <p style="margin:0 0 12px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:#0b1f5c;">Electronic Signature — Legally Binding</p>
         <table style="border-collapse:collapse;width:100%;font-size:13px;">
           <tr>
             <td style="padding:5px 12px 5px 0;color:#374151;font-weight:600;white-space:nowrap;width:160px;">Signed by:</td>
             <td style="padding:5px 0;font-size:17px;font-weight:700;color:#0f172a;font-style:italic;">${escapeHtml(args.signatureName)}</td>
           </tr>
           ${args.signedAt ? `<tr>
             <td style="padding:5px 12px 5px 0;color:#374151;font-weight:600;">Date &amp; time:</td>
             <td style="padding:5px 0;color:#0f172a;">${escapeHtml(args.signedAt)} UTC</td>
           </tr>` : ''}
           ${args.workspaceLabel ? `<tr>
             <td style="padding:5px 12px 5px 0;color:#374151;font-weight:600;">Workspace:</td>
             <td style="padding:5px 0;color:#0f172a;">${escapeHtml(args.workspaceLabel)}</td>
           </tr>` : ''}
           <tr>
             <td style="padding:5px 12px 5px 0;color:#374151;font-weight:600;">Agreement version:</td>
             <td style="padding:5px 0;color:#0f172a;font-family:monospace;">${escapeHtml(CURRENT_VERSION)}</td>
           </tr>
           ${args.ipAddress ? `<tr>
             <td style="padding:5px 12px 5px 0;color:#374151;font-weight:600;">IP address:</td>
             <td style="padding:5px 0;color:#0f172a;font-family:monospace;">${escapeHtml(args.ipAddress)}</td>
           </tr>` : ''}
         </table>
         <p style="margin:14px 0 0;font-size:11px;color:#374151;font-style:italic;">This electronic signature is binding under the E-SIGN Act (15 U.S.C. § 7001) and UETA. A copy of this signed agreement has been emailed to the signer and archived on the Platform.</p>
       </div>`
    : `<div style="border:2px dashed #9ca3af;border-radius:10px;padding:20px 24px;margin-top:32px;background:#f9fafb;">
         <p style="margin:0 0 8px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:#374151;">Signature Block</p>
         <table style="border-collapse:collapse;width:100%;font-size:13px;">
           <tr>
             <td style="padding:5px 12px 5px 0;color:#374151;font-weight:600;white-space:nowrap;width:160px;">Signed by:</td>
             <td style="padding:5px 0;color:#9ca3af;font-style:italic;">Type your full legal name below to sign</td>
           </tr>
           <tr>
             <td style="padding:5px 12px 5px 0;color:#374151;font-weight:600;">Date &amp; time:</td>
             <td style="padding:5px 0;color:#9ca3af;font-style:italic;">Recorded on submission</td>
           </tr>
           <tr>
             <td style="padding:5px 12px 5px 0;color:#374151;font-weight:600;">Agreement version:</td>
             <td style="padding:5px 0;color:#374151;font-family:monospace;">${escapeHtml(CURRENT_VERSION)}</td>
           </tr>
         </table>
         <p style="margin:14px 0 0;font-size:11px;color:#374151;font-style:italic;">Your typed name will serve as a legally binding electronic signature under the E-SIGN Act. A signed copy will be emailed to you.</p>
       </div>`

  const html = renderBodyHtml()

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(AGREEMENT_TITLE)}</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:740px;margin:32px auto;padding:0 24px 48px;color:#0f172a;background:#fff;">
  <h1 style="font-size:22px;font-weight:800;margin:0 0 4px;color:#0f172a;">${escapeHtml(AGREEMENT_TITLE)}</h1>
  <p style="font-size:12px;color:#4b5563;margin:0 0 6px;">Version <span style="font-family:monospace;">${escapeHtml(CURRENT_VERSION)}</span></p>
  <p style="font-size:11px;color:#6b7280;margin:0 0 24px;font-style:italic;">This document is not legal advice. Consult qualified legal counsel for guidance specific to your business and jurisdiction.</p>
  ${html}
  ${sigBlock}
</body>
</html>`
}

function renderBodyHtml(): string {
  return AGREEMENT_BODY
    .split('\n\n')
    .map((para) => {
      const trimmed = para.trim()
      if (trimmed === '---') {
        return `<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />`
      }
      if (trimmed.startsWith('## ')) {
        return `<h2 style="font-size:15px;color:#0f172a;margin:28px 0 8px;font-weight:800;letter-spacing:-0.01em;">${escapeHtml(trimmed.slice(3))}</h2>`
      }
      if (trimmed.startsWith('- ') || trimmed.includes('\n- ')) {
        const items = trimmed
          .split('\n')
          .filter((l) => l.startsWith('- '))
          .map((l) => `<li style="margin-bottom:7px;line-height:1.55;">${renderInline(l.slice(2))}</li>`)
          .join('')
        return `<ul style="margin:8px 0 14px;padding-left:22px;color:#111827;font-size:13px;">${items}</ul>`
      }
      if (/^\([a-z]\)/.test(trimmed)) {
        const items = trimmed
          .split('\n')
          .filter((l) => l.trim().length > 0)
          .map((l) => `<li style="margin-bottom:7px;line-height:1.55;">${renderInline(l.replace(/^\([a-z]\)\s*/, ''))}</li>`)
          .join('')
        return `<ol style="margin:8px 0 14px;padding-left:22px;color:#111827;font-size:13px;list-style-type:lower-alpha;">${items}</ol>`
      }
      return `<p style="margin:8px 0 12px;color:#111827;font-size:13px;line-height:1.65;">${renderInline(trimmed)}</p>`
    })
    .join('')
}

function renderInline(text: string): string {
  const safe = escapeHtml(text)
  return safe.replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#0f172a;">$1</strong>')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
