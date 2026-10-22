import { useState } from 'react'
import { Navigate } from 'react-router'
import { useApp, usePath } from '../app/context'
import { useAction, useTitle } from '../app/hooks'
import { ErrorNote, Notice } from '../components/ui'

export function SignIn() {
  useTitle('Sign in')
  const { repo, user, refreshAuth } = useApp()
  const p = usePath()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const { busy, error, run } = useAction()

  if (repo.mode === 'demo') return <Navigate to={p('/')} replace />
  if (user) return <Navigate to={p('/')} replace />

  return (
    <div style={{ maxWidth: 460 }}>
      <h1>Sign in</h1>
      <p className="muted">For organizers and scorekeepers. Spectators don't need an account — just the event code.</p>
      <ErrorNote error={error} />
      {!sent ? (
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              await repo.requestSignIn(email)
              setSent(true)
            })
          }}
        >
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="btn primary" type="submit" disabled={busy || !email.includes('@')}>
            {busy ? 'Sending…' : 'Email me a sign-in link'}
          </button>
        </form>
      ) : (
        <div className="panel">
          <Notice kind="info">
            We sent a sign-in email to <strong>{email}</strong>. Open the link on this device, or type the 6-digit code from the email below.
          </Notice>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => {
                await repo.verifyCode(email, code)
                refreshAuth()
              })
            }}
          >
            <div className="field">
              <label htmlFor="otp">6-digit code</label>
              <input id="otp" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" maxLength={10} value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              <span className="hint">The code only appears if the email template includes it (see README → Auth email).</span>
            </div>
            <div className="row">
              <button className="btn primary" type="submit" disabled={busy || code.length < 6}>{busy ? 'Checking…' : 'Sign in'}</button>
              <button className="btn quiet" type="button" onClick={() => setSent(false)}>Use a different email</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
