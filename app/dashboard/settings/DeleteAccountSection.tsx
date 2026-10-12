import { requestAccountDeletion } from './deleteAccountAction'

/**
 * Settings > Delete account (Suite CXO). The entry point Apple asks for
 * (5.1.1(v)): a person can start the deletion of their own account from
 * inside the app. See deleteAccountAction.ts for what the button does.
 */
export default function DeleteAccountSection({ owner, state, supportEmail }: { owner: boolean; state: string | null; supportEmail: string }) {
  return (
    <section className="card" id="delete-account" style={{ marginTop: '0.8rem' }}>
      <div className="section-head">
        <h2>Delete account</h2>
        <p>remove your sign-in and your data</p>
      </div>
      {state === 'sent' ? (
        <p className="meta" style={{ margin: 0 }}>
          Your request was sent. We will email you when your account has been deleted. Until then you can keep signing in.
        </p>
      ) : (
        <form action={requestAccountDeletion} style={{ display: 'grid', gap: '0.7rem', maxWidth: 460 }}>
          <p className="meta" style={{ margin: 0 }}>
            {owner
              ? 'You own this company account. Deleting it removes the company, everyone’s sign-in and all of its data. This cannot be undone.'
              : 'This removes your sign-in and your own data: your to-dos, notes, connected Google account and what Ciao remembers for you. Company records you worked on stay with your company. This cannot be undone.'}
          </p>
          <label className="meta" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
            <input type="checkbox" name="confirm" required style={{ marginTop: 3 }} />
            <span>I understand, and I want my account deleted.</span>
          </label>
          {state === 'confirm' && <p className="meta" style={{ margin: 0, color: 'var(--red)' }}>Tick the box to confirm.</p>}
          {state === 'error' && <p className="meta" style={{ margin: 0, color: 'var(--red)' }}>That did not send. Try again, or email {supportEmail}.</p>}
          <div>
            <button type="submit" className="btn dismiss">Ask to delete my account</button>
          </div>
        </form>
      )}
    </section>
  )
}
