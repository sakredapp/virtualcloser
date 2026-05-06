# VirtualCloser Platform Guide
### For internal use: pricing, outbound emails, client proposals, and support

---

## What Is VirtualCloser?

VirtualCloser is an AI-powered sales suite — a full "AI Sales Floor" that automates prospecting, appointment setting, confirmation calling, sales training, and pipeline management. It is built for sales teams and individual closers who want to scale revenue without adding headcount.

The platform is:
- **Voice-first**: AI agents make and receive calls on behalf of the client
- **Telegram-native**: Clients manage everything via chat or voice note from their phone
- **CRM-connected**: Two-way sync with GoHighLevel, HubSpot, Pipedrive, and Salesforce
- **Compliance-aware**: Built-in TCPA tools, Do-Not-Call enforcement, and AI disclosure templates

**Two customer types:**
- **Individual**: Solo closer, SDR, or solopreneur
- **Enterprise**: Sales team with multiple reps, managers, and an owner

---

## Platform Tiers & Pricing

### Base Build (Required for all clients)

| | Individual | Enterprise |
|---|---|---|
| Monthly fee | $99/month | $400/month |
| One-time build fee | $2,000 | $10,000 |
| Users | 1 | Unlimited (role-based) |
| Team features | No | Yes |
| White-label | Optional ($150/mo) | Included in build |
| Dedicated infrastructure | No | Optional |

The base build is the foundation. Add-ons layer on top.

---

## Add-On Products

### AI SDR (Appointment Setter / Outbound Dialer)

Priced by hours per week the AI dialer runs. Billed monthly as a flat subscription.

| Hours/Week | Individual ($6/hr) | Monthly Cost |
|---|---|---|
| 20 hrs/wk | $6/hr | ~$516/mo |
| 30 hrs/wk | $6/hr | ~$774/mo |
| 40 hrs/wk | $6/hr | ~$1,032/mo |
| 50 hrs/wk | $6/hr | ~$1,290/mo |
| 60 hrs/wk | $6/hr | ~$1,548/mo |
| 70 hrs/wk | $6/hr | ~$1,806/mo |
| 80 hrs/wk | $6/hr | ~$2,064/mo |

**Enterprise volume pricing** (same hours tiers, lower rate):
- 1–10 reps: $6/hr
- 11–25 reps: $5.50/hr
- 26–50 reps: $5/hr
- 51–100 reps: $4.50/hr
- 100+ reps: $4/hr

The AI SDR has **four operating modes** (same subscription, client chooses how hours are split):

1. **Receptionist** — Calls booked appointments 30–60 min before meeting time to confirm. Press 1 = confirmed, Press 2 = reschedule. Auto-books new slot and tags CRM.

2. **Appointment Setter** — Cold/warm outbound prospecting. Custom persona + script. Handles objections. Books meetings directly into Google Calendar. Moves lead stage in CRM.

3. **Live Transfer** — Qualifies prospect on call. If a rep is available (per shift schedule), transfers the live call. If no one is available, falls back to booking.

4. **Workflows** — Trigger-based outbound calls. Examples: no-show follow-up, payment overdue, stage-change re-engagement. Rate-limited and time-windowed.

---

### AI Trainer (Sales Roleplay Coach)

AI voice coach for sales reps to practice live objection handling.

| Hours/Week | Individual ($6/hr) | Monthly Cost |
|---|---|---|
| 5 hrs/wk | $6/hr | ~$129/mo |
| 10 hrs/wk | $6/hr | ~$258/mo |
| 20 hrs/wk | $6/hr | ~$516/mo |
| 30 hrs/wk | $6/hr | ~$774/mo |

Same enterprise volume tiers as AI SDR.

**What it does:**
- Live voice roleplay with custom AI persona (e.g., "skeptical VP of Sales")
- Client uploads their actual scripts, objection guides, and product sheets — AI coaches to their playbook
- AI-scored session playback after each call (objection rebuttal quality, closing pace, tone, talk ratio)
- Manager can review rep sessions (enterprise tier)
- Sessions available on-demand, 24/7

---

### AI Receptionist (Flat-Rate Legacy Option)

For clients who only want appointment confirmation calls. No prospecting.

| Plan | Monthly | Volume Cap |
|---|---|---|
| Lite | $50/mo | 100 confirmed appointments |
| Pro | $90/mo | 300 confirmed appointments |

Same function as Receptionist mode inside the AI SDR — confirms appointments 30–60 min before they start.

---

### CRM Integrations

| Integration | Monthly Fee | Notes |
|---|---|---|
| GoHighLevel | $40/mo | Bi-directional sync + SMS workflow enrollment + tag stamping |
| HubSpot | $40/mo | Deal + contact bi-directional sync |
| Pipedrive | $40/mo | Deal + contact bi-directional sync |
| Salesforce | $80/mo | Custom field mapping included |

---

### Analytics & Call Intelligence

| Add-On | Monthly Fee | What It Does |
|---|---|---|
| WAVV KPI Ingest | $20/mo | Real-time dialer dispositions on dashboard |
| Fathom Call Intelligence | $30/mo | Auto-imports meeting transcripts + extracts action items |
| Team Leaderboard | $40/mo | Multi-rep accounts, rep vs. rep scoring, manager rollup |

---

### Messaging & Branding

| Add-On | Monthly Fee | What It Does |
|---|---|---|
| BlueBubbles (iMessage) | $80/mo | Send/receive iMessages from dashboard; AI drafts replies |
| White Label | $150/mo | Custom domain + branding (subdomain, logo, colors) |

---

## What's In the Base Build (Every Client Gets This)

Regardless of tier or add-ons, the base build includes:

- **Telegram bot** — Text or voice note from anywhere. Update CRM, create tasks, schedule calls, brain dump.
- **Morning briefing** — Daily AI-generated digest delivered via Telegram: today's meetings, hot leads, pending tasks.
- **Google Calendar sync** — Meeting hydration with participant details and CRM lookup.
- **Pipeline (Kanban board)** — Drag-and-drop deal stage management with real-time CRM sync.
- **Brain dump** — Voice memos or text notes automatically parsed into action items by AI.
- **Email drafts** — AI writes follow-up emails after meetings and voice notes; client approves or dismisses from dashboard.
- **Custom subdomain** — `{client}.virtualcloser.com` branded portal.
- **Lead management** — Import CSV, manage statuses, track activity per lead.
- **Dashboard** — KPIs, upcoming meetings, recent calls, pending drafts, lead pipeline view.

---

## Enterprise-Only Features

Available on the Enterprise tier ($400/mo base):

- **Org chart** — Full hierarchy: owner → managers → reps. Role-based access control.
- **Team leaderboard** — Rank reps by hot leads, calls placed, appointments booked, and revenue.
- **Manager rollup** — Managers see all their reps' data. Owners see the entire account.
- **Revenue targets** — Set account-level, team-level, and per-rep monthly goals with live progress tracking.
- **Dialer hours allocation** — Owner distributes the total weekly SDR hour pool across reps/managers.
- **Multi-Telegram** — Each rep links their own Telegram.
- **Multi-Calendar** — Each rep connects their own Google Calendar OAuth.
- **Manager room** — Private communication channel, managers only.
- **Owners room** — Private space visible only to the owner.
- **Role hierarchy** — Owner → Admin → Manager → Rep → Observer (full permission matrix).

---

## Role Permissions (Enterprise)

| Role | Can Do |
|---|---|
| **Owner** | Everything including billing, account deletion, and all settings |
| **Admin** | Everything except billing/account deletion; manages members, integrations, teams |
| **Manager** | Reads all team data; edits own and team pipeline; sets team + personal targets |
| **Rep** | Edits own pipeline, leads, calls, and brain items only |
| **Observer** | Read-only access across the account |

---

## Onboarding Flow

### All Clients (Shared Steps)
1. **Kickoff call** (30 min) — VirtualCloser learns their ICP, top objections, CRM setup, and sample deals
2. **Payment confirmed** — Build fee + monthly subscription active in Stripe
3. **Custom subdomain** — `{slug}.virtualcloser.com` provisioned
4. **Lead import** — CSV upload mapped to their account
5. **Telegram bot linked** — Client sends `/link {code}` to `@VirtualCloserBot`
6. **End-to-end test** — Morning scan runs; drafts appear on dashboard; Telegram briefing delivers
7. **Dashboard walkthrough** — 10-min Loom walkthrough (approving drafts, using `/brain`, Telegram interaction)
8. **Billing confirmed** — Recurring subscription live

### Enterprise Extras
9. **Brand assets** — Logo, brand colors, email signature
10. **CRM integration** — Private app token created; sync verified
11. **Email provider** — Gmail or Outlook OAuth connected
12. **Fathom webhook** — Set up to auto-import meeting summaries
13. **Playbook tuning** — AI trained on client's ICP, sales motion, objections
14. **Team setup** — Owner invites members, builds org structure, allocates dialer hours
15. **Per-rep setup** — Each rep links Telegram + Google Calendar
16. **SLA + DPA signing** — Enterprise legal agreements executed

---

## AI Dialer: How It Works (Client Perspective)

### Lead Import
- Client provides a CSV/XLSX with lead names, phone numbers, emails, and any notes
- VirtualCloser maps columns during setup — no specific format required
- Leads appear in the Appointment Setter queue with status: `pending → in_progress → [outcome]`
- Outcome tags: `confirmed`, `appointment-set`, `voicemail`, `no-answer`, `objection`, `reschedule-requested`

### Shift Scheduling
- Client uses the Shifts editor to set what hours the dialer runs each day (Mon–Sun)
- Displayed and enforced in client's local timezone
- TCPA-compliant: UI warns if shifts fall outside 8am–9pm local window
- Default: "Always on" if no shifts are set

### Call Outcomes → CRM
Every call outcome is written back to CRM automatically:
- `vc-confirmed` — Appointment confirmed
- `vc-reschedule-requested` — Prospect wants different time; new slot booked
- `vc-no-answer` — Voicemail or no pickup
- Stage moves happen in real-time as outcomes land

### Post-Call Notifications
- Telegram ping to the rep within seconds of call completion
- Recording + transcript viewable on dashboard
- Action items (if applicable) added to brain dump

---

## Compliance Tools Built In

VirtualCloser handles compliance tooling, but **the client is always the "caller of record"** — they carry the legal liability for their campaigns.

**What VirtualCloser provides:**
- TCPA time-window enforcement (shift editor warns/blocks outside 8am–9pm)
- AI disclosure script templates (required in California, Illinois, Colorado, and others)
- Do-Not-Call suppression list management
- Per-call recording + transcript retention
- Caller ID validation

**What the client is responsible for:**
- Obtaining prior express written consent before calling cell phones
- Scrubbing leads against Federal and state DNC registries
- Disclosing AI-generated voice at the start of every call (where required)
- All-party consent compliance in: CA, CT, DE, FL, IL, MA, MD, MI, MT, NV, NH, OR, PA, WA
- Indemnifying VirtualCloser against any TCPA/FTC/state enforcement actions

Clients must sign the VirtualCloser Liability Agreement (electronic signature) before the platform activates. This agreement covers TCPA, DNC, AI disclosure, data privacy (CCPA, GDPR), and prohibited uses.

---

## Integration Ecosystem

### Voice Provider
- **RevRing** — primary outbound voice AI infrastructure (powers all SDR, Trainer, and Receptionist modes)
- **Twilio** — legacy fallback and phone number provisioning

### CRM
- GoHighLevel (GHL), HubSpot, Pipedrive, Salesforce

### Calendar
- Google Calendar (per-member OAuth on enterprise)

### Call Intelligence
- **Fathom** — meeting transcripts, AI summaries, action item extraction
- **WAVV** — dialer dispositions, per-rep KPIs, recording playback

### Email
- Gmail (OAuth) or Outlook (OAuth) — AI drafts send through client's own email address

### Messaging
- **Telegram** — primary interface (free, included in all tiers)
- **BlueBubbles** — iMessage relay ($80/mo add-on)

### Automation
- Inbound webhooks from GoHighLevel, Fathom, WAVV, RevRing
- Outbound CRM updates on every pipeline stage change, brain item creation, and call outcome

---

## Key Metrics Clients Track

**Daily Dashboard**
- Appointments scheduled this week
- Meetings confirmed today
- AI dialer calls placed
- Average call duration
- Revenue pending (open pipeline value)
- New leads imported this week
- No-show rate (last 30 days)

**AI Dialer**
- Confirmed rate (Receptionist mode)
- Dials placed, connections, appointments booked (Setter mode)
- Live transfers completed vs. fallback books (Transfer mode)
- Workflow completion and conversion rate

**Team (Enterprise)**
- Leaderboard: deals in hot stage, calls placed, appointments booked, revenue on track
- Manager rollup: team totals vs. targets
- Per-rep momentum score (30-day velocity trend)

---

## Positioning & Key Value Props

**For individual closers:**
- Works like a full-time SDR at $6/hr vs. $5,000–7,000/mo for a human
- Available 24/7, never calls sick, never needs training on a new script (just upload a doc)
- Telegram-first means managing your pipeline takes 30 seconds from your phone

**For sales teams:**
- Scale dialer activity without adding headcount
- Uniform script adherence across all reps — AI never goes off-playbook
- Manager visibility into every rep's pipeline and call activity
- AI Trainer keeps reps sharp at a fraction of the cost of external coaching

**Cost comparison talking points:**
- Human SDR: $50,000–$85,000/year salary + benefits + ramp time + turnover
- AI SDR at 40h/wk: ~$12,400/year all-in (base + SDR package) — ~85% cheaper
- AI Receptionist: ~$0.20 per confirmed appointment (vs. $3–8 for a human confirmation call)
- AI Trainer at 10h/wk: $258/mo vs. $200–500/session for a human sales coach

---

## Common Objections & Responses

**"Our prospects will know it's AI and hang up."**
VirtualCloser agents are built to disclose that they're AI when asked directly (required by law in many states). The scripts are designed to be conversational and natural. Connection rates are on par with human SDR teams because the AI doesn't get fatigued, rushes calls, or goes off-script.

**"We already have a CRM / dialer."**
VirtualCloser connects to your existing CRM (GHL, HubSpot, Pipedrive, Salesforce) — it augments your stack, not replaces it. Every outcome the AI generates writes back to your CRM in real-time.

**"What happens with compliance?"**
TCPA tools are built into the platform (time-window enforcement, DNC suppression, disclosure templates). However, the client is the caller of record and signs a liability agreement before activation. VirtualCloser's legal team has reviewed the platform design against FCC rules, TCPA, and state-specific AI disclosure laws.

**"How long to get set up?"**
Individual tier: 3–5 business days from kickoff call to first AI call placed. Enterprise: 7–14 business days depending on CRM integration complexity and team size.

**"Can we start small and scale?"**
Yes. The base build is the starting point. Add AI SDR, Trainer, Receptionist, and integrations as needed. Hour packages can be increased at any billing cycle.

---

## Pricing Summary Cheat Sheet

| Product | Price |
|---|---|
| Individual base build | $99/mo + $2,000 one-time |
| Enterprise base build | $400/mo + $10,000 one-time |
| AI SDR (per hr/wk) | $6/hr individual, $4–6/hr enterprise |
| AI Trainer (per hr/wk) | $6/hr individual, $4–6/hr enterprise |
| AI Receptionist Lite | $50/mo (100 confirmations) |
| AI Receptionist Pro | $90/mo (300 confirmations) |
| GoHighLevel integration | $40/mo |
| HubSpot integration | $40/mo |
| Pipedrive integration | $40/mo |
| Salesforce integration | $80/mo |
| WAVV KPI ingest | $20/mo |
| Fathom call intelligence | $30/mo |
| Team leaderboard | $40/mo |
| BlueBubbles (iMessage) | $80/mo |
| White label | $150/mo |

---

*Last updated: May 2026. For questions, contact team@sakredhealth.com.*
