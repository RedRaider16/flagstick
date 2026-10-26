import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { usePath } from '../../app/context'
import { useBundle } from '../../app/hooks'
import { ErrorNote, Loading, Notice, ScopeTabs } from '../../components/ui'
import { courseStatus, type GroupState } from '../../domain/courseStatus'
import { currentRound, formatTeeTime, nameOf } from '../../domain/derive'
import { useManage } from './ManageLayout'

const LABEL: Record<GroupState, string> = { not_started: 'Not started', on_course: 'On the course', finished: 'Finished', attention: 'Check card' }
/** A group on the course with no new score for this long is worth a look. */
const QUIET_MINUTES = 25

function ago(iso: string, now: number): string {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  return `${h} hr ${m % 60} min ago`
}

/** Admin board: where every group is during play. Updates live as scores come in. */
export function CourseStatus() {
  const { bundle: outer } = useManage()
  const p = usePath()
  const { bundle, error } = useBundle(outer.event.id)
  const [roundId, setRoundId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [filter, setFilter] = useState<GroupState | 'all'>('all')
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  if (error) return <ErrorNote error={error} />
  if (!bundle) return <Loading />
  const round = bundle.rounds.find((r) => r.id === roundId) ?? currentRound(bundle)
  const all = courseStatus(bundle, round)
  const count = (s: GroupState) => all.filter((x) => x.state === s).length
  const shown = filter === 'all' ? all : all.filter((x) => x.state === filter)
  const shotgun = round.startType === 'shotgun'

  return (
    <>
      <ScopeTabs label="Round" options={bundle.rounds.map((r) => ({ scope: r.id, label: `Round ${r.roundNumber}` }))} value={round.id} onChange={setRoundId} />
      {bundle.event.status !== 'in_progress' && <Notice kind="info">Scoring isn't open, so nothing will change here until you start the event.</Notice>}
      {all.length === 0 ? (
        <Notice kind="info">This round has no groups yet. <Link to={p(`manage/${bundle.event.id}/groups`)}>Make groups</Link></Notice>
      ) : (
        <>
          <div className="status-tiles" role="group" aria-label="Show groups">
            {(['all', 'not_started', 'on_course', 'finished', 'attention'] as const).map((s) => (
              <button key={s} type="button" className={`status-tile ${s} ${filter === s ? 'on' : ''}`} aria-pressed={filter === s} onClick={() => setFilter(s)}>
                <span className="n">{s === 'all' ? all.length : count(s)}</span>
                <span>{s === 'all' ? 'All groups' : LABEL[s]}</span>
              </button>
            ))}
          </div>
          <div className="table-wrap panel">
            <table>
              <thead>
                <tr><th>Group</th><th>{shotgun ? 'Start' : 'Tee time'}</th><th>Status</th><th>Thru</th><th>Last score</th><th><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {shown.map((s) => {
                  const quiet = s.state === 'on_course' && s.lastScoreAt && now - Date.parse(s.lastScoreAt) > QUIET_MINUTES * 60000
                  return (
                    <tr key={s.group.id}>
                      <td>
                        <strong>{s.group.name}</strong>
                        <div className="small muted">{s.group.entryIds.map((id) => bundle.entries.find((e) => e.id === id)).filter(Boolean).map((e) => nameOf(bundle, e!)).join('; ')}</div>
                      </td>
                      <td className="num">{shotgun ? `Hole ${s.group.startingHole}` : `${formatTeeTime(s.group.teeTime)}${s.group.startingHole !== 1 ? `, hole ${s.group.startingHole}` : ''}`}</td>
                      <td>
                        <span className={`status-pill ${s.state}`}>{LABEL[s.state]}</span>
                        {s.problems.map((x) => <div key={x} className="small flag-gap">{x}</div>)}
                      </td>
                      <td className="num">{s.state === 'finished' ? 'F' : s.state === 'not_started' ? '—' : `${s.thru}${s.nextHole ? ` (on ${s.nextHole})` : ''}`}</td>
                      <td className="small">
                        {s.lastScoreAt ? ago(s.lastScoreAt, now) : '—'}
                        {quiet && <div className="flag-gap">No new score in {QUIET_MINUTES}+ min</div>}
                      </td>
                      <td><Link className="btn quiet small" to={p(`score/${bundle.event.id}/${s.group.id}`)}>Open card</Link></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="small muted">Updates live as scores come in. Thru counts holes every team or player in the group has finished. "Check card" means a hole was skipped or someone in the group is behind the others.</p>
        </>
      )}
    </>
  )
}
