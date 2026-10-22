import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useApp, usePath } from '../app/context'
import { useAccess, useBundle, useTitle } from '../app/hooks'
import { Leaderboard } from '../components/Leaderboard'
import { ErrorNote, Loading, StatusBadge } from '../components/ui'
import { buildLeaderboard, formatDate, formatTeeTime, nameOf } from '../domain/derive'
import { FORMAT_LABEL } from '../domain/types'

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
  const lb = useMemo(() => (bundle ? buildLeaderboard(bundle) : null), [bundle])
  useTitle(bundle ? `${bundle.event.name} leaderboard` : 'Leaderboard')
  const [tab, setTab] = useState<'board' | 'pairings'>('board')

  if (missing)
    return (
      <>
        <h1>Event not found</h1>
        <p>No published event uses the code <strong>{code}</strong>. Check the code with the organizer.</p>
        <Link className="btn" to={p('/')}>Back</Link>
      </>
    )
  if (error) return <ErrorNote error={error} />
  if (!bundle || !lb) return <Loading />

  const isTeam = bundle.round.format === 'scramble_2'
  const groups = [...bundle.groups].sort((a, b) => (a.teeTime ?? '').localeCompare(b.teeTime ?? '') || a.startingHole - b.startingHole || a.name.localeCompare(b.name))

  return (
    <>
      <div className="event-head">
        <div>
          <h1>{bundle.event.name}</h1>
          <div className="event-meta">
            {formatDate(bundle.event.date)} at {bundle.course?.name ?? 'course TBA'}{bundle.tee ? ` (${bundle.tee.name} tees)` : ''}
          </div>
          <div className="event-meta">{FORMAT_LABEL[bundle.round.format]} <StatusBadge status={bundle.event.status} /></div>
        </div>
        <div className="row no-print">
          {access?.role === 'admin' && <Link className="btn" to={p(`manage/${bundle.event.id}`)}>Manage</Link>}
          {access?.role && bundle.event.status === 'in_progress' && <Link className="btn primary" to={p(`score/${bundle.event.id}`)}>Enter scores</Link>}
        </div>
      </div>
      {bundle.event.description && <p>{bundle.event.description}</p>}

      <div className="tabs no-print" role="tablist">
        <a href="#board" role="tab" aria-selected={tab === 'board'} className={tab === 'board' ? 'active' : ''} onClick={(e) => (e.preventDefault(), setTab('board'))}>Leaderboard</a>
        <a href="#pairings" role="tab" aria-selected={tab === 'pairings'} className={tab === 'pairings' ? 'active' : ''} onClick={(e) => (e.preventDefault(), setTab('pairings'))}>Pairings</a>
      </div>

      {tab === 'board' ? (
        <Leaderboard lb={lb} holes={bundle.holes} title={isTeam ? 'Team leaderboard' : 'Leaderboard'} isTeam={isTeam} live={connected && repo.mode === 'live'} />
      ) : (
        <section className="panel">
          <h2>Pairings</h2>
          {groups.length === 0 ? <p className="muted">Pairings haven't been posted yet.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">Group</th><th scope="col">{bundle.round.startType === 'shotgun' ? 'Start hole' : 'Tee time'}</th><th scope="col">{isTeam ? 'Teams' : 'Players'}</th></tr></thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id}>
                      <td><strong>{g.name}</strong></td>
                      <td className="num" style={{ fontSize: '1.1rem' }}>
                        {bundle.round.startType === 'shotgun' ? `Hole ${g.startingHole}` : formatTeeTime(g.teeTime)}
                        {bundle.round.startType === 'shotgun' && g.teeTime && <span className="muted small"> at {formatTeeTime(g.teeTime)}</span>}
                        {bundle.round.startType === 'tee_times' && g.startingHole !== 1 && <span className="muted small"> from hole {g.startingHole}</span>}
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
