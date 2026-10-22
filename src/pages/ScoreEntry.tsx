import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { useApp, usePath } from '../app/context'
import { useAccess, useBundle, useOnline, useTitle } from '../app/hooks'
import { cellKey, useScoreWriter, type CellState } from '../app/useScoreWriter'
import { ErrorNote, Loading, Notice, useReasonDialog } from '../components/ui'
import { formatTeeTime, nameOf } from '../domain/derive'
import { playerName, type Entry, type EventBundle, type Hole } from '../domain/types'
import { formatToPar, rotation } from '../scoring/leaderboard'
import { parseStrokes } from '../scoring/validation'

function scoringBlocked(b: EventBundle, isAdmin: boolean): string | null {
  if (b.event.status === 'finalized' || b.round.status === 'finalized') return 'Results are final. Scores can no longer be changed.'
  if (isAdmin) return b.event.status === 'draft' ? 'Publish the event before entering scores.' : null
  if (b.event.status !== 'in_progress') return "Scoring hasn't started yet. The organizer will open it when groups tee off."
  if (b.round.status === 'locked') return 'The round is locked. Ask the organizer if a score needs to change.'
  return null
}

export function ScoreHome() {
  const { eventId } = useParams()
  const p = usePath()
  const { bundle, error } = useBundle(eventId)
  const access = useAccess(eventId)
  useTitle('Enter scores')
  if (error) return <ErrorNote error={error} />
  if (!bundle || !access) return <Loading />
  if (!access.role) return <NoAccess code={bundle.event.status !== 'draft' ? bundle.event.publicCode : null} />
  const mine = access.role === 'admin' ? bundle.groups : bundle.groups.filter((g) => access.groupIds.includes(g.id))
  const sorted = [...mine].sort((a, b) => a.startingHole - b.startingHole || (a.teeTime ?? '').localeCompare(b.teeTime ?? '') || a.name.localeCompare(b.name, undefined, { numeric: true }))
  if (sorted.length === 1 && access.role === 'scorekeeper') return <Navigate to={p(`score/${bundle.event.id}/${sorted[0]!.id}`)} replace />
  const blocked = scoringBlocked(bundle, access.role === 'admin')
  return (
    <>
      <h1>{bundle.event.name}</h1>
      <p className="muted">Choose the group you're keeping score for.</p>
      {blocked && <Notice kind="warn">{blocked}</Notice>}
      {sorted.length === 0 ? (
        <Notice kind="info">You haven't been assigned to a group yet. Ask the organizer to assign you.</Notice>
      ) : (
        <ul className="event-list panel">
          {sorted.map((g) => {
            const done = g.entryIds.reduce((s, id) => s + bundle.scores.filter((x) => x.entryId === id).length, 0)
            return (
              <li key={g.id}>
                <div>
                  <strong>{g.name}</strong>
                  <div className="small muted">
                    Starts on hole {g.startingHole}{g.teeTime ? ` at ${formatTeeTime(g.teeTime)}` : ''}. {done} of {g.entryIds.length * 18} scores entered.
                  </div>
                  <div className="small">{g.entryIds.map((id) => bundle.entries.find((e) => e.id === id)).filter(Boolean).map((e) => nameOf(bundle, e!)).join('; ')}</div>
                </div>
                <Link className="btn primary" to={p(`score/${bundle.event.id}/${g.id}`)}>Score this group</Link>
              </li>
            )
          })}
        </ul>
      )}
      <p><Link to={p(`e/${bundle.event.publicCode}`)}>View leaderboard</Link></p>
    </>
  )
}

function NoAccess({ code }: { code: string | null }) {
  const p = usePath()
  const { repo, user } = useApp()
  return (
    <>
      <h1>You can't enter scores for this event</h1>
      <p>{user ? 'Your account is not a scorekeeper for this event. Ask the organizer to add your email.' : repo.mode === 'live' ? 'Sign in with the email the organizer added.' : 'Switch "View as" in the demo bar to Scorekeeper or Administrator.'}</p>
      <div className="row">
        {!user && repo.mode === 'live' && <Link className="btn primary" to={p('signin')}>Sign in</Link>}
        {code && <Link className="btn" to={p(`e/${code}`)}>View leaderboard</Link>}
      </div>
    </>
  )
}

export function ScoreGroup() {
  const { eventId, groupId } = useParams()
  const p = usePath()
  const { bundle, setBundle, error } = useBundle(eventId)
  const access = useAccess(eventId)
  const online = useOnline()
  const writer = useScoreWriter(bundle, setBundle)
  const dialog = useReasonDialog()
  const group = bundle?.groups.find((g) => g.id === groupId)
  useTitle(group ? `${group.name} scoring` : 'Enter scores')

  const order = useMemo(() => rotation(group?.startingHole ?? 1), [group?.startingHole])
  const storeKey = `flagstick-hole-${groupId}`
  const [idx, setIdx] = useState<number | null>(null)

  // Start on the saved hole, else the first hole in the rotation not yet complete.
  useEffect(() => {
    if (!bundle || !group || idx !== null) return
    const saved = Number(sessionStorage.getItem(storeKey))
    if (saved >= 0 && saved < 18 && sessionStorage.getItem(storeKey) !== null) return setIdx(saved)
    const firstOpen = order.findIndex((h) => group.entryIds.some((id) => !bundle.scores.some((s) => s.entryId === id && s.hole === h)))
    setIdx(firstOpen < 0 ? 17 : firstOpen)
  }, [bundle, group, idx, order, storeKey])
  useEffect(() => {
    if (idx !== null) sessionStorage.setItem(storeKey, String(idx))
  }, [idx, storeKey])

  if (error) return <ErrorNote error={error} />
  if (!bundle || !access || idx === null) return group === undefined && bundle ? <Notice kind="error">Group not found.</Notice> : <Loading />
  if (!group) return <Notice kind="error">Group not found.</Notice>
  if (!access.role || (access.role === 'scorekeeper' && !access.groupIds.includes(group.id)))
    return <NoAccess code={bundle.event.status !== 'draft' ? bundle.event.publicCode : null} />
  if (bundle.holes.length !== 18) return <Notice kind="warn">The course layout isn't set up yet, so scores can't be entered.</Notice>

  const isAdmin = access.role === 'admin'
  const blocked = scoringBlocked(bundle, isAdmin)
  const needsReason = isAdmin && bundle.round.status === 'locked'
  const holeNo = order[idx]!
  const hole = bundle.holes.find((h) => h.number === holeNo)!
  const entries = group.entryIds.map((id) => bundle.entries.find((e) => e.id === id)).filter((e): e is Entry => !!e)
  const isTeam = bundle.round.format === 'scramble_2'
  const holeDone = (h: number) => entries.length > 0 && entries.filter((e) => e.status === 'active').every((e) => bundle.scores.some((s) => s.entryId === e.id && s.hole === h))

  const commit = async (entryId: string, value: number | null) => {
    let reason = ''
    if (needsReason) {
      const r = await dialog.ask({ title: 'Correction on a locked round', label: 'Reason (recorded in the history)', required: true, confirmLabel: 'Save correction' })
      if (r === null) return
      reason = r
    }
    await writer.save(entryId, holeNo, value, reason)
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      {dialog.element}
      <div className="split no-print" style={{ marginBottom: '.5rem' }}>
        <div>
          <strong>{group.name}</strong> <span className="muted small">{bundle.event.name}</span>
        </div>
        <Link className="small" to={p(`e/${bundle.event.publicCode}`)}>Leaderboard</Link>
      </div>
      {!online && <Notice kind="warn">You're offline. Scores won't save until your connection returns — tap Retry on any unsaved score.</Notice>}
      {blocked && <Notice kind="warn">{blocked}</Notice>}
      {needsReason && <Notice kind="info">The round is locked. As an admin you can correct scores; each change asks for a reason.</Notice>}

      <div className="hole-bar">
        <button className="nav" type="button" aria-label="Previous hole" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>‹</button>
        <div className="center">
          <div className="hole-no" aria-live="polite"><span className="sr-only">Hole </span>{holeNo}</div>
          <div className="hole-facts">Par {hole.par}{hole.yardage ? `, ${hole.yardage} yds` : ''}, SI {hole.strokeIndex}</div>
          <div className="hole-dots" role="group" aria-label="Jump to hole">
            {order.map((h, i) => (
              <button key={h} type="button" className={`${holeDone(h) ? 'filled' : ''} ${i === idx ? 'cur' : ''}`} onClick={() => setIdx(i)}
                aria-label={`Hole ${h}${holeDone(h) ? ', complete' : ''}`} aria-current={i === idx ? 'step' : undefined}>
                {h}
              </button>
            ))}
          </div>
        </div>
        <button className="nav" type="button" aria-label="Next hole" disabled={idx === 17} onClick={() => setIdx(idx + 1)}>›</button>
      </div>

      <p className="small muted" style={{ marginTop: '-.3rem' }}>
        {isTeam ? 'Scramble: enter one team score per hole.' : 'Enter each player’s own score.'} A blank hole stays blank — it never counts as zero.
      </p>

      {entries.length === 0 && <Notice kind="info">No {isTeam ? 'teams' : 'players'} in this group yet.</Notice>}
      {entries.map((e) => (
        <EntrantCard key={e.id} bundle={bundle} entry={e} hole={hole} state={writer.cells[cellKey(e.id, holeNo)]}
          disabled={!!blocked || (!isAdmin && e.status !== 'active')}
          onSet={(v) => void commit(e.id, v)}
          onRetry={(v) => void commit(e.id, v)}
          onTheirs={() => writer.acceptTheirs(e.id, holeNo)}
          onMine={async () => {
            let reason = ''
            if (needsReason) {
              const r = await dialog.ask({ title: 'Correction on a locked round', label: 'Reason', required: true, confirmLabel: 'Save correction' })
              if (r === null) return
              reason = r
            }
            writer.keepMine(e.id, holeNo, reason)
          }}
          isTeam={isTeam} />
      ))}

      <div className="row" style={{ justifyContent: 'space-between', marginTop: '1rem' }}>
        <button className="btn" type="button" disabled={idx === 0} onClick={() => setIdx(idx - 1)} style={{ minHeight: 'var(--tap)' }}>Previous hole</button>
        <button className="btn primary" type="button" disabled={idx === 17} onClick={() => { setIdx(idx + 1); window.scrollTo({ top: 0 }) }} style={{ minHeight: 'var(--tap)', flex: 1 }}>
          {idx === 17 ? 'Last hole' : `Next: hole ${order[idx + 1]}`}
        </button>
      </div>
    </div>
  )
}

function EntrantCard(props: {
  bundle: EventBundle
  entry: Entry
  hole: Hole
  state: CellState | undefined
  disabled: boolean
  isTeam: boolean
  onSet: (v: number | null) => void
  onRetry: (v: number | null) => void
  onTheirs: () => void
  onMine: () => void
}) {
  const { bundle, entry, hole, state } = props
  const [other, setOther] = useState('')
  const [otherErr, setOtherErr] = useState<string | null>(null)
  const saved = bundle.scores.find((s) => s.entryId === entry.id && s.hole === hole.number)
  const shown = state && (state.kind === 'saving' || state.kind === 'failed') ? state.value : saved?.strokes ?? null
  const mine = bundle.scores.filter((s) => s.entryId === entry.id)
  const parPlayed = mine.reduce((sum, s) => sum + (bundle.holes.find((h) => h.number === s.hole)?.par ?? 0), 0)
  const toPar = mine.length ? mine.reduce((sum, s) => sum + s.strokes, 0) - parPlayed : null
  const team = entry.teamId ? bundle.teams.find((t) => t.id === entry.teamId) : null
  const label = props.isTeam ? team?.name ?? 'Team' : nameOf(bundle, entry)
  const choices = Array.from({ length: 6 }, (_, i) => hole.par - 2 + i).filter((v) => v >= 1)
  const nameId = `ent-${entry.id}`

  return (
    <section className="entrant" aria-labelledby={nameId}>
      <div className="entrant-head">
        <div>
          <div className="entrant-name" id={nameId}>
            {label} {entry.status !== 'active' && <span className={`badge ${entry.status}`}>{entry.status.toUpperCase()}</span>}
          </div>
          <div className="entrant-sub">
            {team && `${team.playerIds.map((id) => bundle.players.find((x) => x.id === id)).filter(Boolean).map((x) => playerName(x!)).join(' and ')}. `}
            {toPar === null ? 'No scores yet' : `${formatToPar(toPar)} thru ${mine.length}`}
          </div>
        </div>
        <div className={`entrant-score ${shown === null ? 'empty' : shown < hole.par ? 'under' : ''}`} aria-label={shown === null ? 'No score' : `Score ${shown}`}>{shown ?? '–'}</div>
      </div>
      <div className="pad" role="group" aria-label={`Score for ${label} on hole ${hole.number}`}>
        {choices.map((v) => (
          <button key={v} type="button" className={`${v === hole.par ? 'par' : ''} ${shown === v ? 'on' : ''}`} aria-pressed={shown === v}
            disabled={props.disabled || state?.kind === 'saving'} onClick={() => props.onSet(v)}
            aria-label={`${v}${v === hole.par ? ' (par)' : ''}`}>
            {v}
          </button>
        ))}
      </div>
      <div className="pad-more">
        <form className="row" style={{ gap: '.4rem' }} onSubmit={(e) => {
          e.preventDefault()
          const r = parseStrokes(other)
          if (!r.ok) return setOtherErr(r.error)
          setOtherErr(null)
          setOther('')
          props.onSet(r.value)
        }}>
          <label htmlFor={`o-${entry.id}`} className="sr-only">Other score for {label}</label>
          <input id={`o-${entry.id}`} type="text" inputMode="numeric" placeholder="Other" value={other} disabled={props.disabled}
            onChange={(e) => setOther(e.target.value.replace(/\D/g, '').slice(0, 2))} />
          <button className="btn small" type="submit" disabled={props.disabled || !other}>Set</button>
        </form>
        {saved && (
          <button className="btn quiet small" type="button" disabled={props.disabled || state?.kind === 'saving'} onClick={() => props.onSet(null)}>Clear hole</button>
        )}
      </div>
      {otherErr && <div className="save-state failed" role="alert">{otherErr}</div>}
      <SaveState state={state} onRetry={props.onRetry} onTheirs={props.onTheirs} onMine={props.onMine} />
    </section>
  )
}

function SaveState({ state, onRetry, onTheirs, onMine }: { state: CellState | undefined; onRetry: (v: number | null) => void; onTheirs: () => void; onMine: () => void }) {
  if (!state) return <div className="save-state" />
  if (state.kind === 'saving')
    return <div className="save-state saving" role="status"><span className="spin" aria-hidden="true" /> Saving…</div>
  if (state.kind === 'saved') return <div className="save-state saved" role="status">✓ Saved</div>
  if (state.kind === 'failed')
    return (
      <div className="save-state failed" role="alert">
        Not saved: {state.message}
        <button className="btn small" type="button" onClick={() => onRetry(state.value)}>Retry</button>
      </div>
    )
  const theirs = state.current ? String(state.current.strokes) : 'blank'
  const mine = state.value === null ? 'blank' : String(state.value)
  return (
    <div className="save-state conflict" role="alert" style={{ flexWrap: 'wrap' }}>
      Someone else changed this hole to {theirs}. Yours: {mine}.
      <button className="btn small" type="button" onClick={onTheirs}>Keep {theirs}</button>
      <button className="btn small" type="button" onClick={onMine}>Use {mine}</button>
    </div>
  )
}
