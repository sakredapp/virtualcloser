/**
 * The "Due soon" morning email: one per member per day, only when something
 * of theirs is due within 7 days or overdue. Each card is a row with its due
 * date and a link that opens it on the board. Black and silver, no red.
 */
import { dueDateLabel, dueWords } from '@/lib/dueRemindersShared'

export type DigestItem = { title: string; board: string; due_date: string; days_left: number; url: string }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function renderDueDigest(input: { firstName: string | null; items: DigestItem[]; boardsUrl: string; settingsUrl: string }): { subject: string; html: string; text: string } {
  const items = [...input.items].sort((a, b) => a.days_left - b.days_left || a.title.localeCompare(b.title))
  const overdue = items.filter((i) => i.days_left < 0).length
  const today = items.filter((i) => i.days_left === 0).length
  const n = items.length
  const subject =
    overdue > 0
      ? `Due soon: ${n} ${n === 1 ? 'card' : 'cards'}, ${overdue} overdue`
      : today > 0
        ? `Due soon: ${n} ${n === 1 ? 'card' : 'cards'}, ${today} due today`
        : `Due soon: ${n} ${n === 1 ? 'card' : 'cards'} this week`
  const hi = input.firstName ? `Good morning, ${input.firstName}.` : 'Good morning.'
  const lead = `${n === 1 ? 'One card' : `${n} cards`} on your boards ${n === 1 ? 'is' : 'are'} due soon.`

  const rows = items
    .map(
      (i) => `
        <tr>
          <td style="padding:14px 0;border-top:1px solid #E6E8EB;">
            <a href="${esc(i.url)}" style="font:600 15px/1.35 Inter,Helvetica,Arial,sans-serif;color:#0F1012;text-decoration:none;">${esc(i.title)}</a>
            <div style="margin-top:3px;font:13px/1.4 Inter,Helvetica,Arial,sans-serif;color:#5B6067;">${esc(dueWords(i.days_left))} &middot; ${esc(dueDateLabel(i.due_date))} &middot; ${esc(i.board)}</div>
          </td>
          <td align="right" style="padding:14px 0 14px 12px;border-top:1px solid #E6E8EB;white-space:nowrap;vertical-align:middle;">
            <a href="${esc(i.url)}" style="display:inline-block;padding:7px 14px;border:1px solid #C9CDD2;border-radius:999px;font:500 13px Inter,Helvetica,Arial,sans-serif;color:#0F1012;text-decoration:none;">Open card</a>
          </td>
        </tr>`,
    )
    .join('')

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#F5F6F7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F6F7;">
    <tr><td align="center" style="padding:28px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E6E8EB;border-radius:14px;">
        <tr><td style="padding:26px 26px 8px;">
          <div style="font:600 11px/1 Inter,Helvetica,Arial,sans-serif;letter-spacing:0.12em;text-transform:uppercase;color:#5B6067;">Suite CXO &middot; Due soon</div>
          <h1 style="margin:12px 0 6px;font:500 24px/1.25 Lora,Georgia,serif;color:#0F1012;">${esc(hi)}</h1>
          <p style="margin:0;font:15px/1.5 Inter,Helvetica,Arial,sans-serif;color:#0F1012;">${esc(lead)}</p>
        </td></tr>
        <tr><td style="padding:10px 26px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}
          </table>
        </td></tr>
        <tr><td style="padding:14px 26px 26px;">
          <a href="${esc(input.boardsUrl)}" style="display:inline-block;padding:11px 20px;border-radius:999px;background:#0F1012;color:#FFFFFF;font:500 14px Inter,Helvetica,Arial,sans-serif;text-decoration:none;">Open my boards</a>
        </td></tr>
      </table>
      <p style="max-width:560px;margin:14px auto 0;font:12px/1.5 Inter,Helvetica,Arial,sans-serif;color:#5B6067;">You get this because you turned on due-date emails. <a href="${esc(input.settingsUrl)}" style="color:#5B6067;">Turn them off in Settings</a>.</p>
    </td></tr>
  </table>
</body></html>`

  const text = [
    hi,
    lead,
    '',
    ...items.map((i) => `- ${i.title} (${i.board})\n  ${dueWords(i.days_left)}, ${dueDateLabel(i.due_date)}\n  ${i.url}`),
    '',
    `Open my boards: ${input.boardsUrl}`,
    `Turn these emails off: ${input.settingsUrl}`,
  ].join('\n')

  return { subject, html, text }
}
