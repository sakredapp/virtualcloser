'use client'

/**
 * The empty chat on a phone: a few questions an executive would ask, each one
 * tap to send. Drawn over the chat sheet only while it is open and nothing has
 * been asked yet (cxo-phone.css shows it when the sheet's body is empty), so a
 * login that already gets its own suggestions keeps those and never sees two
 * sets. A tap hands the question to the chat bar the same way the product's
 * other "ask" buttons do (the `mira:ask` event), so it is sent, not just typed.
 */
export const PHONE_STARTERS = [
  'How is revenue this month vs last month?',
  'Who is behind on their targets?',
  'What needs my approval?',
  'What changed this week?',
]

export default function PhoneStarters({ assistantName }: { assistantName: string }) {
  return (
    <div className="cxph-starters" role="group" aria-label="Suggested questions">
      <h2>Ask {assistantName}</h2>
      <p>Tap a question, or type your own below.</p>
      {PHONE_STARTERS.map((q) => (
        <button key={q} type="button" onClick={() => window.dispatchEvent(new CustomEvent('mira:ask', { detail: { text: q } }))}>
          <span>{q}</span>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      ))}
    </div>
  )
}
