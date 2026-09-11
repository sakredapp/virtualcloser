/**
 * Application Roleplay Engine — the "writing business" half of VC Roleplay.
 *
 * A sales roleplay ends when the prospect says yes. THIS module trains what
 * happens next: the carrier application. The canonical VC process places
 * Application Preparation / Submission after the sale — the agent selects the
 * carrier/product, asks every application question, captures COMPLETE answers,
 * runs the disclosures, and submits.
 *
 * Three layers:
 *
 *  1. COMMON_APPLICATION_SECTIONS — the carrier-agnostic application skeleton
 *     (identity → coverage → replacement → lifestyle → medical → family →
 *     payment → disclosures → signatures).
 *
 *  2. CARRIER_OVERLAYS — per-carrier wording, order, and conditional
 *     questions, sourced from actual public application documents:
 *       · Transamerica Individual Life Application Part 1 (APA401008T) and
 *         Part 2 Health History (MPM31008TCA)
 *       · Foresters Life & CI Application (406578 CAN), incl. the Temporary
 *         Insurance Agreement questions and iGO-style point-of-sale decision
 *       · Banner/LGA digital-app workflow shape; Ethos consumer-led flow
 *
 *  3. APPLICANT_PROFILES — the HIDDEN ANSWER SHEET. Each profile carries the
 *     ground truth about the applicant AND the vague first answer the AI
 *     prospect gives before being probed ("something with my heart last
 *     year"). The grader scores whether the producer extracted the full
 *     record: procedure, diagnosis, date, outcome, treating physician.
 *
 * SYNTHETIC IDENTITY RULE: every SSN uses the reserved 900–999 area (never
 * issued to a real person) and every routing number fails the ABA checksum.
 * The data trains data-capture behavior; it can never be real PII.
 */

import { getAnthropic } from './anthropic'

const MODEL_SMART =
  process.env.ANTHROPIC_MODEL_SMART || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5'

// ── 1. Common application skeleton ──────────────────────────────────────────

export type AppFieldSpec = {
  id: string
  /** What the producer must ask. */
  ask: string
  /** What counts as a COMPLETE capture — the grader checks against this. */
  complete: string
  required?: boolean
}

export type AppSection = {
  id: string
  title: string
  fields: AppFieldSpec[]
}

export const COMMON_APPLICATION_SECTIONS: AppSection[] = [
  {
    id: 'identity',
    title: 'Proposed Insured — identity',
    fields: [
      { id: 'legal_name', ask: 'Full legal name', complete: 'First, middle, last exactly as on government ID', required: true },
      { id: 'dob', ask: 'Date of birth', complete: 'Month, day, and year', required: true },
      { id: 'ssn', ask: 'Social Security number', complete: 'All nine digits, read back to confirm', required: true },
      { id: 'birthplace_citizenship', ask: 'Birthplace and U.S. citizenship', complete: 'City/state or country of birth; citizen yes/no; if no, visa type/immigration status', required: true },
      { id: 'address', ask: 'Residence address', complete: 'Street (no P.O. Box), city, state, ZIP', required: true },
      { id: 'phone_email', ask: 'Phone and email', complete: 'At least one working phone; email if available' },
      { id: 'drivers_license', ask: "Driver's license", complete: 'Number AND issuing state', required: true },
    ],
  },
  {
    id: 'employment_financial',
    title: 'Employment & financial justification',
    fields: [
      { id: 'occupation', ask: 'Occupation and duties', complete: 'Job title AND specific duties', required: true },
      { id: 'employer', ask: 'Employer', complete: 'Employer name; length of employment', required: true },
      { id: 'income', ask: 'Annual income', complete: 'A dollar figure, not a range', required: true },
      { id: 'net_worth', ask: 'Net worth', complete: 'A dollar figure' },
    ],
  },
  {
    id: 'owner_beneficiary',
    title: 'Owner & beneficiaries',
    fields: [
      { id: 'owner', ask: 'Policy owner if other than insured', complete: 'Name, relationship, DOB, SSN, address — or confirmed self-owned', required: true },
      { id: 'primary_beneficiary', ask: 'Primary beneficiary', complete: 'LEGAL first and last name (not "my wife"), relationship, date of birth, share %', required: true },
      { id: 'contingent_beneficiary', ask: 'Contingent beneficiary', complete: 'Legal name, relationship, DOB — or an explicit "none"', required: true },
    ],
  },
  {
    id: 'coverage_replacement',
    title: 'Existing coverage & replacement',
    fields: [
      { id: 'existing_insurance', ask: 'Existing life insurance or annuities', complete: 'Company, policy number if known, face amount, type for EACH policy — or a confirmed none', required: true },
      { id: 'replacement', ask: 'Replacement intent', complete: 'Explicit yes/no on discontinuing, replacing, or changing existing coverage; if yes, replacement forms flagged', required: true },
      { id: 'pending_applications', ask: 'Applications pending with other companies', complete: 'Yes/no; if yes, company and amounts', required: true },
    ],
  },
  {
    id: 'product',
    title: 'Product & face amount',
    fields: [
      { id: 'plan', ask: 'Plan applied for', complete: 'Product name and term/duration', required: true },
      { id: 'face_amount', ask: 'Face amount', complete: 'A dollar amount', required: true },
      { id: 'riders', ask: 'Riders', complete: 'Each rider named with amount, or a confirmed none' },
    ],
  },
  {
    id: 'lifestyle',
    title: 'Lifestyle & avocation',
    fields: [
      { id: 'tobacco', ask: 'Tobacco/nicotine use', complete: 'Ever used yes/no; type; frequency; DATE LAST USED', required: true },
      { id: 'hazardous', ask: 'Hazardous activities (past participation or 2-year intent)', complete: 'Yes/no across sky diving, racing, scuba, climbing, extreme sports; if yes, activity questionnaire flagged', required: true },
      { id: 'foreign_travel', ask: 'Foreign travel plans (next 12 months)', complete: 'Yes/no; if yes, destination, purpose, duration', required: true },
      { id: 'aviation', ask: 'Non-passenger flying (past 2 years or planned)', complete: 'Yes/no; if yes, aviation questionnaire flagged', required: true },
      { id: 'driving', ask: 'Driving record (past 5 years)', complete: 'Moving violations, DUI, reckless driving — each yes/no WITH dates for any yes', required: true },
      { id: 'criminal', ask: 'Felony/misdemeanor history', complete: 'Yes/no; if yes, state, date, and details of offense', required: true },
      { id: 'bankruptcy', ask: 'Bankruptcy (current or recent)', complete: 'Yes/no; if yes, chapter, date filed, discharge status', required: true },
      { id: 'military', ask: 'Armed forces membership or deployment orders', complete: 'Yes/no with details', required: true },
    ],
  },
  {
    id: 'medical',
    title: 'Medical history (Part 2)',
    fields: [
      { id: 'height_weight', ask: 'Height and weight', complete: 'Both figures, plus >10–15 lb change in past year yes/no with reason', required: true },
      { id: 'primary_physician', ask: 'Primary care physician', complete: 'Name, address/phone, date and reason of LAST VISIT', required: true },
      { id: 'condition_sweep', ask: 'Condition-by-condition health sweep', complete: 'Heart/BP, cancer, diabetes, respiratory, GI, neuro, mental health, kidney/GU, musculoskeletal — each explicitly asked, not summarized as "any health issues?"', required: true },
      { id: 'medications', ask: 'Current medications (Rx, OTC, vitamins, supplements)', complete: 'For EACH: name, dosage, frequency, and why prescribed. "Something for cholesterol" is not a capture', required: true },
      { id: 'hospitalizations', ask: 'Hospitalizations, surgeries, procedures (5 yrs)', complete: 'For EACH event: procedure/diagnosis, DATE, outcome, treating physician and facility. "Something with my heart" is not a capture', required: true },
      { id: 'recent_care', ask: 'Physician consults / tests / imaging in past 5 years', complete: 'Yes/no; each yes detailed with date, reason, result', required: true },
      { id: 'pending_care', ask: 'Pending tests, treatment, or symptoms not yet seen for', complete: 'Explicit yes/no — this is the question that voids coverage when skipped', required: true },
      { id: 'substances', ask: 'Drug/alcohol history', complete: 'Non-prescribed drug use (10 yrs) yes/no; treatment or counseling advice ever yes/no; alcohol quantity per week', required: true },
      { id: 'family_history', ask: 'Family medical history', complete: 'Father, mother, siblings: age if living + health, or age at death + cause. Cancer/diabetes/heart disease flagged', required: true },
    ],
  },
  {
    id: 'payment',
    title: 'Premium & payment',
    fields: [
      { id: 'mode', ask: 'Premium mode', complete: 'Monthly/quarterly/semi-annual/annual; draft vs direct bill', required: true },
      { id: 'bank', ask: 'Bank draft details', complete: 'Financial institution, routing number, account number, account type, name on account', required: true },
      { id: 'draft_date', ask: 'Draft date', complete: 'A specific day of month (1–28)', required: true },
    ],
  },
  {
    id: 'disclosures',
    title: 'Disclosures, authorizations & signatures',
    fields: [
      { id: 'representations', ask: 'True-and-complete representation', complete: 'Applicant told answers are represented true/complete and misstatements can void a claim', required: true },
      { id: 'hipaa_mib', ask: 'Authorization to obtain information (MIB / medical records)', complete: 'Authorization read and acknowledged', required: true },
      { id: 'fraud_warning', ask: 'State fraud warning', complete: 'Referenced for the applicant’s state', required: true },
      { id: 'conditional_receipt', ask: 'Conditional receipt / temporary insurance', complete: 'Eligibility checked against carrier rules BEFORE collecting money; terms explained if issued', required: true },
      { id: 'esign', ask: 'Signatures', complete: 'Insured (and owner if different) signature captured; producer signature; city/state/date', required: true },
      { id: 'submit', ask: 'Submission', complete: 'Application actually submitted and the applicant told what happens next (underwriting, possible exam/APS)', required: true },
    ],
  },
]

// ── 2. Carrier overlays ─────────────────────────────────────────────────────

export type CarrierKey = 'transamerica' | 'foresters' | 'banner' | 'ethos'

export type CarrierOverlay = {
  key: CarrierKey
  carrier: string
  product: string
  /** How this carrier's application actually flows — fed to grader + persona. */
  workflow: string
  /** Carrier-specific questions/wording layered on the common skeleton. */
  emphases: string[]
  /** Money-handling / receipt rules the producer must get right. */
  moneyRules: string[]
}

export const CARRIER_OVERLAYS: Record<CarrierKey, CarrierOverlay> = {
  transamerica: {
    key: 'transamerica',
    carrier: 'Transamerica',
    product: 'Trendsetter-style term (Individual Life Application Part 1 + Part 2)',
    workflow:
      'Agent-driven. Part 1 (application) is completed with the producer question by question, then Part 2 (health history) — every question must be asked and the answer recorded; details of every yes answer need dates, diagnoses, duration, outcome, treatments, and names/addresses of hospitals and physicians. PAC form with voided check for bank draft. Conditional receipt only if eligibility rules pass.',
    emphases: [
      'Risk classification and nicotine classification are declared up front (Preferred Plus/Preferred/Standard Plus/Standard; Nicotine/Non-Nicotine).',
      'Existing insurance chart: type, company/policy number, face amount, replacement yes/no PER POLICY; plus total accidental death in force.',
      'Policies on the insured\'s life that the applicant does NOT own (sold or settled) must be asked separately.',
      'Hazardous activities list is explicit: hang-gliding, sky diving, parachuting, ultralight flying, vehicle racing, scuba, mountain/rock climbing, rodeos, competitive skiing/snowboarding, extreme sports — past participation OR next-two-years intent.',
      'Foreign travel question excludes U.S., Canada, Western Europe, Hong Kong, Australia, New Zealand — travel elsewhere triggers the Residency & Travel Questionnaire.',
      'Driving: moving violations, DUI, reckless — each separately, with dates, past five years, plus license number and state.',
      'Part 2 health sweep is organ-system by organ-system (5a–5l), then drug/alcohol (6), then 5-year consults/tests/surgery (7), then family history, >15 lb weight change, pregnancy (8), then the medication question: "OTHER THAN those already disclosed, are you currently taking any prescription, vitamin, supplement or over-the-counter medication?" — list ALL and why.',
      'Family record grid: father, mother, brothers, sisters — age and present health, or age at death and cause.',
      'Nicotine within past five years: type, frequency, date last used.',
      'Actively-at-work question: full time at usual place of business for the last 180 days.',
    ],
    moneyRules: [
      'Do NOT accept money or complete the conditional receipt if: heart/stroke/vascular/cancer/HIV treatment in the last 12 months; age under 16 or over 75; or amount over $2,000,000.',
      'Checks payable to Transamerica Life Insurance Company — never to the agent, never blank payee.',
      'Payment with app must at least equal the full first modal premium (2 months for monthly PAC).',
    ],
  },
  foresters: {
    key: 'foresters',
    carrier: 'Foresters',
    product: 'YourTerm-style term via iGO e-App',
    workflow:
      'e-App (iPipeline iGO) with conditional branching: question → conditional follow-up → additional form → signatures → submit, with a POINT-OF-SALE DECISION for eligible non-med products. All questions must be asked and recorded completely and accurately, and answers must come from the proposed insured. A VOID cheque (or full banking details) is required for PAC. Temporary insurance has its own six-question gate.',
    emphases: [
      'Identity includes driver\'s licence number, issuing province/state, AND date of issue; occupation must list specific duties.',
      'Lifestyle history separates tobacco/nicotine/marijuana within 12 months AND within 24 months (type + daily amount for each).',
      'Licence suspension/revocation or 3+ moving violations in 10 years is its own question.',
      'Travel/work/live outside North America for more than 1 month is its own question (frequency, location, length).',
      'Alcohol: do you drink (weekly quantity + type); ever advised to reduce; ever treated — three separate questions.',
      'Health sweep 14a–14j by system, then the catch-alls: 15 ever hospitalized/treated for anything NOT mentioned; 16 ever received disability benefit/pension; 17 currently under observation or treatment; 18 aware of symptoms not yet seen for, or tests pending/results unknown.',
      'Question 20: date and reason of LAST consultation, the practitioner\'s name/address/phone, whether treatment or medication was given, and primary care physician with years attended.',
      'Family history (19) is specific: heart disease, stroke, cancer (specify type), diabetes, kidney disease, mental illness, alcoholism, and named neuro diseases — with age at onset.',
      'Ever rated/declined/modified on any application is its own question, with company, date, and final decision.',
      'Beneficiary rules: shares must total 100%; trustee required for minor beneficiaries.',
    ],
    moneyRules: [
      'Temporary Insurance Agreement: collect premium ONLY if total ≤ $500,000 and the applicant is under 65 — and only if all six TIA health questions are answered NO truthfully.',
      'TIA payment: at least 1/12 of total annual premium on the same date the application is signed.',
      'Point-of-sale decision may come back approved / referred / declined — the producer must set expectations either way.',
    ],
  },
  banner: {
    key: 'banner',
    carrier: 'Banner Life / Legal & General America',
    product: 'OPTerm via digital application',
    workflow:
      'Client-completion model: the producer starts the ticket, the CLIENT receives a link and completes the ~20-minute online application themselves (medical and financial history). Depending on the case, a medical exam follows: height, weight, BP/pulse, blood/urine, possible EKG. The producer\'s job shifts to setting expectations, prepping the client on what they\'ll be asked, and following up on outstanding requirements.',
    emphases: [
      'The producer does NOT ask every Part 2 question — the workflow itself changes. Training focus: a complete, accurate ticket; prepping the client with documents (ID, SSN, physician info, medication list); explaining the exam.',
    ],
    moneyRules: ['No money with the ticket; payment is set up in the digital flow.'],
  },
  ethos: {
    key: 'ethos',
    carrier: 'Ethos',
    product: 'Consumer-driven digital term',
    workflow:
      'Consumer-led online application. The applicant should have ready: driver license info, SSN, personal and family medical history, and current prescription info. Underwriting may ask additional follow-ups. Producer trains the client on accurate self-disclosure.',
    emphases: [
      'Coaching emphasis: what the client should have on hand, and why honest complete disclosure protects the death benefit.',
    ],
    moneyRules: ['Payment collected inside the digital flow.'],
  },
}

// ── 3. Applicant profiles — the hidden answer sheet ─────────────────────────

export type VagueFact = {
  /** What the AI prospect says the FIRST time the topic comes up. */
  firstAnswer: string
  /** The complete truth, surrendered only under specific probing. */
  truth: string
  /** The probes a competent producer must make to earn the truth. */
  requiredProbes: string[]
}

export type ApplicantProfile = {
  key: string
  displayName: string
  summary: string
  /** Structured ground truth (all synthetic — 900-area SSNs, invalid ABA routing). */
  facts: Record<string, string>
  /** The traps: answers that arrive incomplete on purpose. */
  vagueFacts: VagueFact[]
}

export const APPLICANT_PROFILES: ApplicantProfile[] = [
  {
    key: 'sam_carter_app',
    displayName: 'Sam Carter — application',
    summary:
      'Sam said yes to $250k of 20-year term mortgage protection. 56, skeptical, hates paperwork, gives short answers. Heart history he downplays.',
    facts: {
      legal_name: 'Samuel Ray Carter',
      dob: 'March 14, 1970',
      ssn: '900-41-7736 (synthetic — reserved 900 area)',
      birthplace_citizenship: 'Tulsa, Oklahoma; U.S. citizen',
      address: '1418 Birchwood Lane, Broken Arrow, OK 74012',
      phone: '(918) 555-0164',
      drivers_license: 'OK license K4472281',
      occupation: 'HVAC service manager — supervises 6 techs, quotes jobs, occasional attic/crawlspace work',
      employer: 'Redline Mechanical, 11 years',
      income: '$84,000',
      net_worth: 'about $310,000 including home equity',
      owner: 'Self-owned',
      primary_beneficiary: 'Wife — legal name Dana Marie Carter, DOB July 2, 1972, 100%',
      contingent_beneficiary: 'Son — Tyler James Carter, DOB Jan 19, 1998',
      existing_insurance: '$50,000 group term through work (employer-provided). Not replacing it.',
      pending_applications: 'None',
      tobacco: 'Quit cigarettes 6 years ago; the honest date last used is August 2020. No other nicotine.',
      hazardous: 'None',
      foreign_travel: 'None planned',
      aviation: 'No',
      driving: 'One speeding ticket, February 2024. No DUI, no reckless.',
      criminal: 'None',
      bankruptcy: 'None',
      military: 'No',
      height_weight: `6'0", 228 lbs; lost about 12 lbs this past year on doctor's orders after the heart thing`,
      primary_physician: 'Dr. Alan Reyes, Broken Arrow Family Medicine, last visit May 2026 for follow-up bloodwork',
      family_history: 'Father died at 61 — heart attack. Mother living, 79, type 2 diabetes. One sister, 52, healthy.',
      alcohol: 'Two or three beers on weekends. Never treated, never advised to cut down.',
      payment: 'Draft from checking — First Sovereign Bank, routing 021000018 (synthetic — fails ABA checksum), account 4401172239, draft on the 3rd',
    },
    vagueFacts: [
      {
        firstAnswer: '"Well, I had something done with my heart last year."',
        truth:
          'Cardiac catheterization with one stent placed (LAD), September 2025, after an abnormal stress test. Diagnosed coronary artery disease. Outcome good; cardiologist Dr. Priya Nathan at Tulsa Heart Institute; cleared at 6-month follow-up March 2026.',
        requiredProbes: [
          'What exactly was the procedure?',
          'What was the diagnosis?',
          'When was it done (month/year)?',
          'What was the outcome / any follow-up?',
          'Which doctor and facility?',
        ],
      },
      {
        firstAnswer: '"Yeah, lisinopril and something for cholesterol."',
        truth:
          'Lisinopril 20 mg once daily (blood pressure), atorvastatin 40 mg once daily (cholesterol), and 81 mg aspirin daily since the stent. He forgets the aspirin unless asked "anything over the counter?"',
        requiredProbes: [
          'Name of the cholesterol medication?',
          'Dosage and frequency of each?',
          'Why prescribed?',
          'Any over-the-counter meds, vitamins, or supplements?',
        ],
      },
      {
        firstAnswer: '"My wife gets it all — just put my wife."',
        truth: 'Legal name Dana Marie Carter, DOB July 2, 1972, spouse, 100% primary. Contingent: son Tyler James Carter, DOB Jan 19, 1998.',
        requiredProbes: ['Her legal first and last name?', 'Date of birth?', 'Contingent beneficiary?'],
      },
    ],
  },
  {
    key: 'jamie_torres_app',
    displayName: 'Jamie Torres — application',
    summary:
      'Jamie said yes to $400k of 30-year term. 34, new parent, first home, cooperative but scattered — loses track of details, has to be walked through everything.',
    facts: {
      legal_name: 'Jamie Elena Torres',
      dob: 'November 8, 1991',
      ssn: '900-62-4415 (synthetic — reserved 900 area)',
      birthplace_citizenship: 'El Paso, Texas; U.S. citizen',
      address: '2205 Alder Creek Drive, Round Rock, TX 78664',
      phone: '(512) 555-0119',
      drivers_license: 'TX license 44120987',
      occupation: 'Pediatric nurse (RN) — floor shifts, no travel',
      employer: 'St. David\'s Round Rock, 4 years',
      income: '$71,500',
      net_worth: 'about $60,000',
      owner: 'Self-owned',
      primary_beneficiary: 'Husband — legal name Marcus Aurelio Torres, DOB April 22, 1989, 100%',
      contingent_beneficiary: 'Daughter — Isabella Rose Torres, DOB February 3, 2026 (trustee needed: minor)',
      existing_insurance: 'None personal; $25,000 group through the hospital',
      pending_applications: 'None',
      tobacco: 'Never',
      hazardous: 'Did one tandem skydive at a bachelorette party in 2023; no plans to repeat. (Truthful answer to the past-participation question is YES.)',
      foreign_travel: 'Trip to visit family in Chihuahua, Mexico planned within 12 months, about 10 days',
      aviation: 'No',
      driving: 'Clean record',
      criminal: 'None',
      bankruptcy: 'None',
      military: 'No',
      height_weight: `5'5", 148 lbs; weight down 20+ lbs in the past year — postpartum, delivered February 2026`,
      primary_physician: 'Dr. Susan Okafor, Round Rock Family Care, last visit June 2026 (postpartum follow-up)',
      family_history: 'Father 63, high blood pressure. Mother 60, healthy. Brother 30, healthy.',
      alcohol: 'Occasional glass of wine',
      payment: 'Draft from joint checking — Lone Star Community CU, routing 111000020 (synthetic — fails ABA checksum), account 220398841, draft on the 15th',
    },
    vagueFacts: [
      {
        firstAnswer: '"I was in the hospital earlier this year, but it was just for the baby."',
        truth:
          'Delivery February 3, 2026 at St. David\'s Round Rock — but it was a C-section after preeclampsia, with blood pressure monitored postpartum through April 2026 (now resolved, no ongoing meds). OB: Dr. Lena Vasquez. The preeclampsia is the material fact she doesn\'t volunteer.',
        requiredProbes: [
          'Any complications with the delivery?',
          'What was the diagnosis (preeclampsia)?',
          'Any treatment or medication afterward, and when did it resolve?',
          'Which doctor and facility?',
        ],
      },
      {
        firstAnswer: '"Just my prenatal vitamins, I think."',
        truth:
          'Prenatal vitamin daily, plus sertraline 50 mg once daily started March 2026 for postpartum anxiety, prescribed by Dr. Okafor — she doesn\'t mention it until asked specifically about prescriptions or mental health.',
        requiredProbes: [
          'Any prescription medications at all?',
          'Dosage, frequency, start date?',
          'What is it for and who prescribed it?',
        ],
      },
      {
        firstAnswer: '"Beneficiary is my husband, and then the baby I guess?"',
        truth:
          'Marcus Aurelio Torres, DOB April 22, 1989, 100% primary. Contingent Isabella Rose Torres (DOB Feb 3, 2026) — a MINOR, so the producer must address a trustee for proceeds payable to a minor.',
        requiredProbes: [
          'Husband\'s legal name and date of birth?',
          'Daughter\'s legal name and date of birth?',
          'Trustee arrangement for the minor contingent?',
        ],
      },
    ],
  },
]

export function getApplicantProfile(key: string): ApplicantProfile | null {
  return APPLICANT_PROFILES.find((p) => p.key === key) ?? null
}

// ── Persona prompt builder (for provisioning the RevRing applicant agents) ──

export function buildApplicantAgentPrompt(profile: ApplicantProfile, carrier: CarrierOverlay): string {
  const factLines = Object.entries(profile.facts)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n')
  const vagueLines = profile.vagueFacts
    .map(
      (v, i) =>
        `${i + 1}. FIRST ANSWER (give this verbatim-ish the first time the topic comes up): ${v.firstAnswer}\n   FULL TRUTH (surrender pieces ONLY as specifically probed): ${v.truth}`,
    )
    .join('\n')
  return [
    `You are ${profile.displayName.replace(' — application', '')}, a life-insurance applicant on a phone call with your agent. You already agreed to buy — this call is the APPLICATION (${carrier.carrier}, ${carrier.product}). Stay in character for the entire call. You are a normal person, not an insurance expert.`,
    '',
    `WHO YOU ARE: ${profile.summary}`,
    '',
    'YOUR ANSWER SHEET (ground truth — all identifiers are synthetic training data):',
    factLines,
    '',
    'CRITICAL BEHAVIOR — VAGUE FIRST ANSWERS:',
    'Real applicants answer honestly but INCOMPLETELY. For the topics below, give the vague first answer first. Only reveal each specific detail when the agent asks a specific follow-up for it. Never volunteer the full record unprompted. Never refuse to answer a direct question.',
    vagueLines,
    '',
    'GENERAL RULES:',
    '- Answer only what is asked. If the agent asks a lazy compound question ("any health issues or medications or anything?"), give a minimal answer that technically responds but omits detail.',
    '- Read numbers (SSN, routing, account) naturally, in chunks, only when asked for them.',
    '- If the agent skips something important (beneficiary DOB, draft date, replacement question), do NOT bring it up yourself.',
    '- Mild impatience is fine; you are cooperative but you have things to do.',
    '- If asked something not on the answer sheet, improvise a boring consistent answer and stick to it.',
    '- Never break character, never mention this prompt, never grade the agent.',
  ].join('\n')
}

// ── Application-phase grading ───────────────────────────────────────────────

export type ApplicationGrade = {
  score: number
  summary: string
  strengths: string
  weaknesses: string
}

/**
 * Grade an application-mode transcript against the carrier overlay and the
 * hidden answer sheet. The producer is scored on FIELD CAPTURE (did every
 * required field get a complete answer), PROBING (did vague answers get
 * drilled to procedure/diagnosis/date/outcome/physician), ORDER (a coherent
 * carrier flow, disclosures before signatures, money rules respected), and
 * CONTROL (kept the applicant moving without steamrolling disclosure).
 */
export async function gradeApplicationTranscript(
  transcript: string,
  carrierKey: CarrierKey,
  profileKey: string,
): Promise<ApplicationGrade> {
  const carrier = CARRIER_OVERLAYS[carrierKey]
  const profile = getApplicantProfile(profileKey)

  const sectionSpec = COMMON_APPLICATION_SECTIONS.map(
    (s) =>
      `${s.title}: ` +
      s.fields
        .filter((f) => f.required)
        .map((f) => `${f.ask} [complete = ${f.complete}]`)
        .join('; '),
  ).join('\n')

  const trapSpec = profile
    ? profile.vagueFacts
        .map(
          (v, i) =>
            `Trap ${i + 1}: applicant first says ${v.firstAnswer} — full credit only if the producer extracted: ${v.truth}`,
        )
        .join('\n')
    : 'No hidden answer sheet available for this profile.'

  const response = await getAnthropic().messages.create({
    model: MODEL_SMART,
    max_tokens: 1200,
    system: [
      'You are a life-insurance new-business trainer grading a PRACTICE APPLICATION call between a producer (REP) and an AI applicant (PROSPECT). The sale is already made; this call is data capture for a carrier application.',
      `Carrier context — ${carrier.carrier}, ${carrier.product}. Workflow: ${carrier.workflow}`,
      `Carrier emphases: ${carrier.emphases.join(' | ')}`,
      `Money/receipt rules: ${carrier.moneyRules.join(' | ')}`,
      '',
      'REQUIRED FIELDS (the application skeleton — judge whether each was asked AND captured completely):',
      sectionSpec,
      '',
      'HIDDEN ANSWER SHEET TRAPS (the applicant deliberately answered vaguely; grade the probing):',
      trapSpec,
      '',
      'Scoring, weighted: field capture 40% (missed required fields are the cardinal sin — an incomplete app bounces from underwriting), probing on the traps 30% ("something with my heart" left unprobed = automatic weakness), carrier order/disclosures/money rules 20%, call control and applicant experience 10%.',
      'Be a coach who was on the call: name the exact fields missed and quote the vague answers the producer accepted.',
      'Reply with ONLY a JSON object: {"score": <integer 0-100>, "summary": "<2-3 sentence verdict>", "strengths": "<concrete>", "weaknesses": "<the specific fields/probes to fix, concrete>"}',
    ].join('\n'),
    messages: [{ role: 'user', content: transcript.slice(0, 60_000) }],
  })

  const raw = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('roleplay_app_grade_unparseable')
  const parsed = JSON.parse(jsonMatch[0]) as Partial<ApplicationGrade>
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(parsed.score ?? 0)))),
    summary: String(parsed.summary ?? '').slice(0, 2000),
    strengths: String(parsed.strengths ?? '').slice(0, 2000),
    weaknesses: String(parsed.weaknesses ?? '').slice(0, 2000),
  }
}
