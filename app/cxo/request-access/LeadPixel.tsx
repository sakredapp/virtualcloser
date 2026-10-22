'use client'

/**
 * Whop Pixel `lead` for the "Book a call" form. The form posts to a server
 * action and redirects to ?sent=1&lead=<prospect id>, so:
 *   - RememberLeadContact keeps the name and email the visitor typed in this
 *     tab's sessionStorage at submit (never in a URL, never from the server);
 *   - LeadSent fires `lead` once on the thank-you page with event_id from our
 *     own prospect row, plus that name and email as plain text, then forgets them.
 * Whop counts each event_id once, so a refresh never adds a second lead.
 * Without the pixel on the page (a company's own host) nothing is sent.
 */
import { useEffect } from 'react'
import { CXO_LEAD_CONTACT_KEY, cxoLeadEvent } from '@/lib/whopPixel'
import { whopTrack } from '@/lib/whopPixelClient'

export function RememberLeadContact({ formId }: { formId: string }) {
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null
    if (!form) return
    const onSubmit = () => {
      try {
        const fd = new FormData(form)
        const email = String(fd.get('email') ?? '').trim().slice(0, 200)
        const name = String(fd.get('name') ?? '').trim().slice(0, 120)
        sessionStorage.setItem(CXO_LEAD_CONTACT_KEY, JSON.stringify({ email, name }))
      } catch {
        // Storage blocked: the lead still fires with its event_id.
      }
    }
    form.addEventListener('submit', onSubmit)
    return () => form.removeEventListener('submit', onSubmit)
  }, [formId])
  return null
}

export function LeadSent({ prospectId }: { prospectId: string }) {
  useEffect(() => {
    let contact: { email?: string; name?: string } | undefined
    try {
      const raw = sessionStorage.getItem(CXO_LEAD_CONTACT_KEY)
      sessionStorage.removeItem(CXO_LEAD_CONTACT_KEY)
      if (raw) contact = JSON.parse(raw)
    } catch {
      contact = undefined
    }
    const ev = cxoLeadEvent(prospectId, contact)
    // The pixel's conversion events keep only email/phone; identify carries the name.
    if (ev.email || ev.name) {
      const [first, ...rest] = (ev.name ?? '').split(/\s+/)
      whopTrack('identify', {
        ...(ev.email ? { email: ev.email } : {}),
        ...(ev.name ? { full_name: ev.name, first_name: first, ...(rest.length ? { last_name: rest.join(' ') } : {}) } : {}),
      })
    }
    whopTrack('lead', ev)
  }, [prospectId])
  return null
}
