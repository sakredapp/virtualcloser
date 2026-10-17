import RailIcon, { type RailIconName } from '@/app/components/cxo/RailIcon'
import ThemeSwitch from '@/app/components/cxo/ThemeSwitch'
import type { PhoneVersion } from '@/lib/phoneVersions'
import { initialsOf } from './PhoneHome'
import { PhonePaneLink } from './PhonePane'
import PhoneSignOut from './PhoneSignOut'
import { Go } from './PhoneTabBar'

/**
 * Me on a phone: a grouped settings screen. Who is signed in, then one row
 * per thing they can change, in three groups (You, Company, App), then Sign
 * out on its own.
 *
 * A row either goes to a page that already exists (Integrations, Calendar
 * accounts, Adoption) or opens one of the Settings page's own sections as a
 * page of its own (PhonePane: Your assistant, Reminders, Assistant name, Password, Usage,
 * Co-admins). Those sections are the same ones a wider screen shows, so no
 * setting is lost; a row is listed only when its section is on the page for
 * this person. Phone width only.
 */
export type PhoneMePanes = Partial<Record<'assistant' | 'reminders' | 'assistantName' | 'password' | 'usage' | 'coadmins' | 'deleteAccount', boolean>>

type Row = { key: string; icon: RailIconName | 'bell' | 'lock' | 'people'; title: string; about: string } & ({ href: string } | { pane: string })

function Icon({ name }: { name: Row['icon'] }) {
  const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (name === 'bell') return <svg viewBox="0 0 20 20" aria-hidden {...line}><path d="M5 14V9a5 5 0 0 1 10 0v5l1.2 1.5H3.8z" /><path d="M8.3 17.2a2 2 0 0 0 3.4 0" /></svg>
  if (name === 'lock') return <svg viewBox="0 0 20 20" aria-hidden {...line}><rect x="4" y="9" width="12" height="8" rx="2.2" /><path d="M6.8 9V6.7a3.2 3.2 0 0 1 6.4 0V9" /></svg>
  if (name === 'people') return <svg viewBox="0 0 20 20" aria-hidden {...line}><circle cx="7.5" cy="7.5" r="2.6" /><path d="M2.8 16c.5-2.5 2.3-3.8 4.7-3.8s4.2 1.3 4.7 3.8" /><path d="M13 5.2a2.4 2.4 0 0 1 0 4.6M14.6 12.5c1.4.5 2.3 1.7 2.6 3.5" /></svg>
  return <RailIcon name={name} />
}

const Chev = () => (
  <svg className="chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9.5 6 6 6-6 6" /></svg>
)

function Group({ title, rows }: { title: string; rows: Row[] }) {
  if (!rows.length) return null
  return (
    <>
      <p className="cxph-sub">{title}</p>
      <div className="cxph-card cxph-set">
        {rows.map((r) => {
          const inner = (
            <>
              <span className="ic" aria-hidden><Icon name={r.icon} /></span>
              <span className="t"><b>{r.title}</b><small>{r.about}</small></span>
              <Chev />
            </>
          )
          return 'pane' in r
            ? <PhonePaneLink key={r.key} pane={r.pane} className="row">{inner}</PhonePaneLink>
            : <Go key={r.key} href={r.href} className="row">{inner}</Go>
        })}
      </div>
    </>
  )
}

export default function PhoneMe({ version, name, email, role, companyName, admin, assistant, panes = {}, demo, assistantName }: {
  version: PhoneVersion
  name: string | null
  email: string | null
  role: string | null
  companyName: string | null
  /** Owner or admin: also sees Adoption and people. */
  admin: boolean
  /** An exec's assistant: sees Working for, not the company pages. */
  assistant: boolean
  /** Which of the Settings page's sections are on the page for this person (each one listed gets a row). */
  panes?: PhoneMePanes
  /** The public demo: its own links, and no real sign-out. */
  demo?: { integrations: string; calendar: string; adoption: string; signOut: string }
  /** The assistant's name for this viewer (the setting, resolved on the server); else the version's default. */
  assistantName?: string
}) {
  const aiName = assistantName || version.assistantName
  const company = version.wordmark ?? companyName ?? version.appName
  const you: Row[] = [
    ...(assistant ? [{ key: 'working-for', href: '/dashboard/assistant', icon: 'execs' as const, title: 'Working for', about: 'The executives you assist' }] : []),
    ...(panes.assistant ? [{ key: 'assistant', pane: 'assistant', icon: 'execs' as const, title: 'Your assistant', about: 'Someone who works your calendar and to-dos' }] : []),
    ...(panes.reminders ? [{ key: 'reminders', pane: 'reminders', icon: 'bell' as const, title: 'Reminders', about: 'When you hear about what is due' }] : []),
    ...(panes.assistantName ? [{ key: 'assistant-name', pane: 'assistant-name', icon: 'profile' as const, title: 'Assistant name', about: `What ${aiName} is called` }] : []),
    ...(panes.password ? [{ key: 'password', pane: 'password', icon: 'lock' as const, title: 'Password', about: 'Change what you sign in with' }] : []),
    ...(panes.deleteAccount ? [{ key: 'delete-account', pane: 'delete-account', icon: 'lock' as const, title: 'Delete account', about: 'Remove your sign-in and your data' }] : []),
  ]
  const companyRows: Row[] = assistant ? [] : [
    { key: 'integrations', href: demo?.integrations ?? '/dashboard/integrations', icon: 'integrations', title: 'Integrations', about: 'Google, your notes and your own AI' },
    { key: 'calendar', href: demo?.calendar ?? '/dashboard/calendar#accounts', icon: 'calendar', title: 'Calendar accounts', about: 'Which calendars show up' },
    ...(admin ? [{ key: 'adoption', href: demo?.adoption ?? '/dashboard/settings/adoption', icon: 'performance' as const, title: 'Adoption', about: 'Who is using what' }] : []),
    ...(panes.usage ? [{ key: 'usage', pane: 'usage', icon: 'reports' as const, title: 'Usage', about: `Questions asked of ${aiName} this month` }] : []),
    ...(panes.coadmins ? [{ key: 'coadmins', pane: 'coadmins', icon: 'people' as const, title: 'Co-admins', about: 'People who can act on this account' }] : []),
  ]
  const who = name || email || 'Account'
  return (
    <div className="cxph cxph-only cxph-me">
      <div className="cxph-prof">
        <span className="cxph-avatar ink" aria-hidden>{initialsOf(who)}</span>
        <span>
          <b>{who}</b>
          <small>{[role ? role.replace(/^\w/, (c) => c.toUpperCase()) : null, company].filter(Boolean).join(' at ')}</small>
          {email && name && <small>{email}</small>}
        </span>
      </div>

      <Group title="You" rows={you} />
      <Group title="Company" rows={companyRows} />

      <p className="cxph-sub">App</p>
      <div className="cxph-card cxph-set">
        <div className="row">
          <span className="t"><b>Appearance</b></span>
          <ThemeSwitch />
        </div>
      </div>

      <div className="cxph-card cxph-set" style={{ marginTop: 22 }}>
        <PhoneSignOut href={demo?.signOut ?? '/logout'} company={company} demo={!!demo} />
      </div>
    </div>
  )
}
