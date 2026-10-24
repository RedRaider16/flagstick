import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useApp, usePath } from '../app/context'
import { boardRounds, cardDetail } from '../app/board'
import { useAccess, useBundle, useTitle } from '../app/hooks'
import { Leaderboard } from '../components/Leaderboard'
import { ErrorNote, Loading, ScopeTabs, StatusBadge } from '../components/ui'
import { buildEventLeaderboard, currentRound, eventDates, eventFormatText, formatTeeTime, isTeamEvent, leaderboardScopes, nameOf, roundGroups, teeOf, type Scope } from '../domain/derive'
import { formatMoney } from '../domain/types'
import { formatCloses, registrationState } from './Register'

export function PublicEvent() {
  const { code } = useParams()
  const { repo } = useApp()
  const p = usePath()
  const [eventId, setEventId] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    setMissing(false)
    repo.findEventByCode(code ?? '').then((e) => (e ? setEventId(e.id) : setMissing(true)), () => setMissing(true))
  }, [repo, code])

  const { bundle, error, connected } = useBundle(eventId ?? undefined)
  const access = useAccess(eventId ?? undefined)
  const [scope, setScope] = useState<Scope | null>(null)
  const scopes = useMemo(() => (bundle ? leaderboardScopes(bundle) : []), [bundle])
  const active: Scope | null = bundle ? (scope && scopes.some((x) => x.scope === scope) ? scope : bundle.event.cumulative && scopes[0]?.scope === 'overall' ? 'overall' : currentRound(bundle).id) : null
  const lb = useMemo(() => (bundle && active ? buildEventLeaderboard(bundle, active) : null), [bundle, active])
  useTitle(bundle ? `${bundle.event.name} leaderboard` : 'Leaderboard')
  const [tab, setTab] = useState<'board' | 'pairings'>('board')
  const [pairRound, setPairRound] = useState<string | null>(null)

  if (missing)
    return (
      <>
        <h1>Event not found</h1>
        <p>No published event uses the code <strong>{code}</strong>. Check the code with the organizer.</p>
        <Link className="btn" to={p('/')}>Back</Link>
      </>
    )
  if (error) return <ErrorNote error={error} />
  if (!bundle || !lb || !active) return <Loading />

  const isTeam = isTeamEvent(bundle)
  const pr = bundle.rounds.find((r) => r.id === pairRound) ?? currentRound(bundle)
  const tees = [...new Set(bundle.rounds.map((r) => teeOf(bundle, r.teeId)?.name).filter(Boolean))]
  const groups = [...roundGroups(bundle, pr.id)].sort((a, b) => (a.teeTime ?? '').localeCompare(b.teeTime ?? '') || a.startingHole - b.startingHole || a.name.localeCompare(b.name))

  return (
    <>
      <div className="event-head">
        <div>
          <h1>{bundle.event.name}</h1>
          <div className="event-meta">
            {eventDates(bundle)} at {bundle.course?.name ?? 'course TBA'}{tees.length ? ` (${tees.join(', ')} tees)` : ''}
          </div>
          <div className="event-meta">{eventFormatText(bundle)}{bundle.flights.length > 0 && `, ${bundle.flights.length} flights`} <StatusBadge status={bundle.event.status} /></div>
        </div>
        <div className="row no-print">
          {access?.role === 'admin' && <Link className="btn" to={p(`manage/${bundle.event.id}`)}>Manage</Link>}
          {access?.role && bundle.event.status === 'in_progress' && <Link className="btn primary" to={p(`score/${bundle.event.id}`)}>Enter scores</Link>}
        </div>
      </div>
      {bundle.event.description && <p>{bundle.event.description}</p>}
      {(() => {
        const rs = registrationState(bundle)
        if (!rs.canRegister) return null
        const r = bundle.event.registration
        return (
          <section className="reg-callout no-print" aria-labelledby="reg-h">
            <h2 id="reg-h">Registration is open</h2>
            <p style={{ margin: '0 0 .6rem' }}>
              {r.entryFeeCents !== null && <>{formatMoney(r.entryFeeCents)} per player. </>}
              {r.closesAt && <>Closes {formatCloses(r.closesAt, bundle.event.timezone)}. </>}
              {rs.spotsLeft !== null && (rs.spotsLeft === 0 ? 'The field is full; new sign-ups join the waitlist.' : `${rs.spotsLeft} spot${rs.spotsLeft === 1 ? '' : 's'} left.`)}
            </p>
            <Link className="btn primary" to={p(`e/${bundle.event.publicCode}/register`)} style={{ minHeight: 'var(--tap)' }}>
              {rs.spotsLeft === 0 ? 'Join the waitlist' : isTeam ? 'Register your team' : 'Register'}
            </Link>
          </section>
        )
      })()}

      <div className="tabs no-print" role="tablist">
        <a href="#board" role="tab" aria-selected={tab === 'board'} className={tab === 'board' ? 'active' : ''} onClick={(e) => (e.preventDefault(), setTab('board'))}>Leaderboard</a>
        <a href="#pairings" role="tab" aria-selected={tab === 'pairings'} className={tab === 'pairings' ? 'active' : ''} onClick={(e) => (e.preventDefault(), setTab('pairings'))}>Pairings</a>
      </div>

      {tab === 'board' ? (
        <>
          <ScopeTabs label="Leaderboard view" options={scopes} value={active} onChange={setScope} />
          <Leaderboard lb={lb} rounds={boardRounds(bundle, active)} detail={cardDetail(bundle)}
            title={`${scopes.find((x) => x.scope === active)?.label ?? 'Leaderboard'}${isTeam ? ' — teams' : ''}`} isTeam={isTeam} live={connected && repo.mode === 'live'} />
        </>
      ) : (
        <section className="panel">
          <h2>Pairings{bundle.rounds.length > 1 ? `, round ${pr.roundNumber}` : ''}</h2>
          <ScopeTabs label="Round" options={bundle.rounds.map((r) => ({ scope: r.id, label: `Round ${r.roundNumber}` }))} value={pr.id} onChange={setPairRound} />
          {groups.length === 0 ? <p className="muted">Pairings haven't been posted yet.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">Group</th><th scope="col">{pr.startType === 'shotgun' ? 'Start hole' : 'Tee time'}</th><th scope="col">{isTeam ? 'Teams' : 'Players'}</th></tr></thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id}>
                      <td><strong>{g.name}</strong></td>
                      <td className="num" style={{ fontSize: '1.1rem' }}>
                        {pr.startType === 'shotgun' ? `Hole ${g.startingHole}` : formatTeeTime(g.teeTime)}
                        {pr.startType === 'shotgun' && g.teeTime && <span className="muted small"> at {formatTeeTime(g.teeTime)}</span>}
                        {pr.startType === 'tee_times' && g.startingHole !== 1 && <span className="muted small"> from hole {g.startingHole}</span>}
                      </td>
                      <td>{g.entryIds.map((id) => bundle.entries.find((e) => e.id === id)).filter(Boolean).map((e) => nameOf(bundle, e!)).join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {repo.mode === 'live' && !connected && <p className="small muted">Live updates are reconnecting. Refresh if scores look stale.</p>}
    </>
  )
}
