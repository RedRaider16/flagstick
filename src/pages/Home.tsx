import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useApp, usePath } from '../app/context'
import { useTitle } from '../app/hooks'
import { ErrorNote, Loading, StatusBadge } from '../components/ui'
import { errorMessage } from '../data/errors'
import { formatDate } from '../domain/derive'
import type { GolfEvent } from '../domain/types'

export function Home() {
  useTitle('')
  const { repo, user, isOrganizer, authReady } = useApp()
  const p = usePath()
  const nav = useNavigate()
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [events, setEvents] = useState<GolfEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authReady) return
    if (!user) {
      setEvents([])
      return
    }
    repo.myEvents().then(setEvents, (e) => setError(errorMessage(e)))
  }, [repo, user, authReady])

  const lookup = async (e: React.FormEvent) => {
    e.preventDefault()
    const c = code.trim().toUpperCase()
    if (!/^[A-Z0-9]{6}$/.test(c)) return setCodeError('Event codes are 6 letters and numbers, like K7M2QX.')
    setCodeError(null)
    const ev = await repo.findEventByCode(c).catch(() => null)
    if (!ev) return setCodeError(`No published event uses the code ${c}. Check it with the organizer.`)
    nav(p(`e/${c}`))
  }

  return (
    <>
      <section className="hero">
        <h1>Follow a tournament</h1>
        <p className="muted">Enter the event code from the organizer to see pairings and the live leaderboard.</p>
        <form className="code-form" onSubmit={lookup} noValidate>
          <label htmlFor="code" className="sr-only">Event code</label>
          <input id="code" type="text" inputMode="text" autoComplete="off" maxLength={6} placeholder="Event code" value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())} aria-describedby={codeError ? 'code-err' : undefined} />
          <button className="btn primary" type="submit">View</button>
        </form>
        {codeError && <p id="code-err" className="small" style={{ color: 'var(--danger)', marginTop: '.4rem' }}>{codeError}</p>}
        {repo.mode === 'demo' && (
          <p className="small muted" style={{ marginTop: '.5rem' }}>Demo codes: DEMO01 (stroke play, in progress) and DEMO02 (scramble, draft — visible to staff only).</p>
        )}
      </section>

      {!authReady ? (
        <Loading />
      ) : user ? (
        <section className="panel">
          <div className="split">
            <h2>Your events</h2>
            {isOrganizer && <Link className="btn primary" to={p('new')}>New event</Link>}
          </div>
          <ErrorNote error={error} />
          {events === null ? (
            <Loading />
          ) : events.length === 0 ? (
            <p className="muted">
              {isOrganizer
                ? 'No events yet. Set up a course, then create your first event.'
                : "You're not on the staff of any event yet. Ask the organizer to add your email, then come back here."}
            </p>
          ) : (
            <ul className="event-list">
              {events.map((ev) => (
                <li key={ev.id}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{ev.name}</div>
                    <div className="muted small">{formatDate(ev.date)} <StatusBadge status={ev.status} /></div>
                  </div>
                  <div className="row">
                    <Link className="btn" to={p(`manage/${ev.id}`)}>Open</Link>
                    {ev.status !== 'draft' && <Link className="btn quiet" to={p(`e/${ev.publicCode}`)}>Leaderboard</Link>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : repo.mode === 'live' ? (
        <section className="panel">
          <h2>Running an event or keeping score?</h2>
          <p>Sign in with the email address the organizer added to the event.</p>
          <Link className="btn primary" to={p('signin')}>Sign in</Link>
        </section>
      ) : (
        <section className="panel">
          <h2>You're viewing the demo as a spectator</h2>
          <p>Switch "View as" in the yellow bar to Administrator to set up events, or to Scorekeeper to try score entry.</p>
        </section>
      )}
    </>
  )
}
