import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { useApp, usePath } from '../app/context'
import { useAccess, useBundle, useOnline, useTitle } from '../app/hooks'
import { cellKey, useScoreWriter, type CellState } from '../app/useScoreWriter'
import type { ScoreSlot } from '../data/repo'
import { ErrorNote, Loading, Notice, useReasonDialog } from '../components/ui'
import { HoleWinnersForm } from './manage/SideGames'
import { buildEventLeaderboard, currentRound, entryPlayers, formatOf, formatTeeTime, holesDone, isTeamEvent, nameOf, roundGroups, roundHoles, slotScore, teeHoles } from '../domain/derive'
import { ENTRY_STATUS_LABEL, playerName, type Entry, type EventBundle, type Player, type Round } from '../domain/types'
import { countingScore, segmentFor } from '../scoring/formats'
import { formatToPar, rotation } from '../scoring/leaderboard'
import { parseStrokes } from '../scoring/validation'

function scoringBlocked(b: EventBundle, round: Round, isAdmin: boolean): string | null {
  if (b.event.isTemplate) return 'This is a template. Create this year\'s event from it to enter scores.'
  if (b.event.status === 'finalized' || round.status === 'finalized') return 'Results for this round are final. Scores can no longer be changed.'
  if (isAdmin) return b.event.status === 'draft' ? 'Publish the event before entering scores.' : null
  if (b.event.status !== 'in_progress') return "Scoring hasn't started yet. The organizer will open it when groups tee off."
  if (round.status === 'locked') return 'The round is locked. Ask the organizer if a score needs to change.'
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
  const round = currentRound(bundle)
  const roundGs = roundGroups(bundle, round.id)
  const mine = access.role === 'admin' ? roundGs : roundGs.filter((g) => access.groupIds.includes(g.id))
  const sorted = [...mine].sort((a, b) => a.startingHole - b.startingHole || (a.teeTime ?? '').localeCompare(b.teeTime ?? '') || a.name.localeCompare(b.name, undefined, { numeric: true }))
  if (sorted.length === 1 && access.role === 'scorekeeper') return <Navigate to={p(`score/${bundle.event.id}/${sorted[0]!.id}`)} replace />
  const blocked = scoringBlocked(bundle, round, access.role === 'admin')
  const other = access.role === 'admin' ? bundle.rounds.filter((r) => r.id !== round.id && roundGroups(bundle, r.id).length > 0) : []
  return (
    <>
      <h1>{bundle.event.name}</h1>
      <p className="muted">{bundle.rounds.length > 1 ? `Round ${round.roundNumber}. ` : ''}Choose the group you're keeping score for.</p>
      {blocked && <Notice kind="warn">{blocked}</Notice>}
      {sorted.length === 0 ? (
        <Notice kind="info">You haven't been assigned to a group yet. Ask the organizer to assign you.</Notice>
      ) : (
        <ul className="event-list panel">
          {sorted.map((g) => {
            const done = g.entryIds.reduce((s, id) => s + holesDone(bundle, round, id), 0)
            return (
              <li key={g.id}>
                <div>
                  <strong>{g.name}</strong>
                  <div className="small muted">
                    Starts on hole {g.startingHole}{g.teeTime ? ` at ${formatTeeTime(g.teeTime)}` : ''}. {done} of {g.entryIds.length * 18} holes complete.
                  </div>
                  <div className="small">{g.entryIds.map((id) => bundle.entries.find((e) => e.id === id)).filter(Boolean).map((e) => nameOf(bundle, e!)).join('; ')}</div>
                </div>
                <Link className="btn primary" to={p(`score/${bundle.event.id}/${g.id}`)}>Score this group</Link>
              </li>
            )
          })}
        </ul>
      )}
      {other.length > 0 && (
        <details className="panel">
          <summary>Other rounds (admin corrections)</summary>
          {other.map((r) => (
            <div key={r.id} style={{ marginTop: '.5rem' }}>
              <strong>Round {r.roundNumber}</strong>{' '}
              {roundGroups(bundle, r.id).map((g) => <Link key={g.id} className="btn quiet small" to={p(`score/${bundle.event.id}/${g.id}`)}>{g.name}</Link>)}
            </div>
          ))}
        </details>
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
  const { bundle, setBundle, error, reload } = useBundle(eventId)
  const access = useAccess(eventId)
  const online = useOnline()
  const writer = useScoreWriter(bundle, setBundle)
  const dialog = useReasonDialog()
  const group = bundle?.groups.find((g) => g.id === groupId)
  const round = bundle && group ? bundle.rounds.find((r) => r.id === group.roundId) ?? null : null
  useTitle(group ? `${group.name} scoring` : 'Enter scores')

  const order = useMemo(() => rotation(group?.startingHole ?? 1), [group?.startingHole])
  const lb = useMemo(() => (bundle && round ? buildEventLeaderboard(bundle, round.id) : null), [bundle, round])
  const storeKey = `flagstick-hole-${groupId}`
  const [idx, setIdx] = useState<number | null>(null)

  const entryHoleDone = (b: EventBundle, r: Round, entryId: string, h: number) => {
    const row = lb?.groups.flatMap((g) => g.rows).find((x) => x.entryId === entryId)
    return row?.rounds[0]?.holeScores.has(h) ?? !!slotScore(b, r.id, entryId, null, h)
  }

  // Start on the saved hole, else the first hole in the rotation not yet complete.
  useEffect(() => {
    if (!bundle || !group || !round || idx !== null || !lb) return
    const saved = Number(sessionStorage.getItem(storeKey))
    if (saved >= 0 && saved < 18 && sessionStorage.getItem(storeKey) !== null) return setIdx(saved)
    const firstOpen = order.findIndex((h) => group.entryIds.some((id) => !entryHoleDone(bundle, round, id, h)))
    setIdx(firstOpen < 0 ? 17 : firstOpen)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, group, round, idx, order, storeKey, lb])
  useEffect(() => {
    if (idx !== null) sessionStorage.setItem(storeKey, String(idx))
  }, [idx, storeKey])

  if (error) return <ErrorNote error={error} />
  if (bundle && !group) return <Notice kind="error">Group not found.</Notice>
  if (!bundle || !access || !group || !round || idx === null) return <Loading />
  if (!access.role || (access.role === 'scorekeeper' && !access.groupIds.includes(group.id)))
    return <NoAccess code={bundle.event.status !== 'draft' ? bundle.event.publicCode : null} />
  const holes = roundHoles(bundle, round)
  if (holes.length !== 18) return <Notice kind="warn">The course layout isn't set up yet, so scores can't be entered.</Notice>

  const isAdmin = access.role === 'admin'
  const blocked = scoringBlocked(bundle, round, isAdmin)
  const needsReason = isAdmin && round.status === 'locked'
  const holeNo = order[idx]!
  const hole = holes.find((h) => h.number === holeNo)!
  const seg = segmentFor(round.segments, holeNo)
  const entries = group.entryIds.map((id) => bundle.entries.find((e) => e.id === id)).filter((e): e is Entry => !!e)
  const isTeam = isTeamEvent(bundle)
  const holeDone = (h: number) => entries.length > 0 && entries.filter((e) => e.status === 'active').every((e) => entryHoleDone(bundle, round, e.id, h))
  const rowOf = (entryId: string) => lb?.groups.flatMap((g) => g.rows).find((x) => x.entryId === entryId)

  const askReason = async () => {
    if (!needsReason) return ''
    return dialog.ask({ title: 'Correction on a locked round', label: 'Reason (recorded in the history)', required: true, confirmLabel: 'Save correction' })
  }
  const commit = async (slot: ScoreSlot, value: number | null) => {
    const reason = await askReason()
    if (reason === null) return
    await writer.save(slot, value, reason)
  }
  const howTo =
    seg.method === 'best_ball'
      ? `Best ball: enter every player's score; the lowest ${seg.count === 1 ? 'one counts' : `${seg.count} count`}. Leave a pick-up blank.`
      : seg.method === 'individual' ? 'Enter each player’s own score.'
      : `${seg.method === 'scramble' ? 'Scramble' : 'Alternate shot'}: enter one team score.`

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      {dialog.element}
      <div className="split no-print" style={{ marginBottom: '.5rem' }}>
        <div>
          <strong>{group.name}</strong> <span className="muted small">{bundle.event.name}{bundle.rounds.length > 1 ? `, round ${round.roundNumber}` : ''}</span>
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
        {formatOf(bundle, round)}. {howTo} A blank hole stays blank — it never counts as zero.
      </p>

      {entries.length === 0 && <Notice kind="info">No {isTeam ? 'teams' : 'players'} in this group yet.</Notice>}
      {entries.map((e) => {
        const row = rowOf(e.id)
        const team = e.teamId ? bundle.teams.find((t) => t.id === e.teamId) : null
        const members = entryPlayers(bundle, e)
        const label = isTeam ? team?.name ?? 'Team' : nameOf(bundle, e)
        // Individual events: par from the player's own tee when it differs.
        const own = !isTeam && members[0]?.teeId && members[0].teeId !== round.teeId ? teeHoles(bundle, members[0].teeId).find((h) => h.number === holeNo) : undefined
        const par = own?.par ?? hole.par
        const lines: { slot: ScoreSlot; name: string | null }[] =
          seg.method === 'best_ball'
            ? members.map((pl: Player) => ({ slot: { roundId: round.id, entryId: e.id, playerId: pl.id, hole: holeNo }, name: playerName(pl) }))
            : [{ slot: { roundId: round.id, entryId: e.id, playerId: null, hole: holeNo }, name: null }]
        const playerVals = new Map(members.map((pl) => [pl.id, slotScore(bundle, round.id, e.id, pl.id, holeNo)?.strokes]).filter((x): x is [string, number] => x[1] !== undefined))
        const counts = seg.method === 'best_ball' ? countingScore(seg, { players: playerVals }) : null
        const cell = row?.rounds[0]
        return (
          <section key={e.id} className="entrant" aria-labelledby={`ent-${e.id}`}>
            <div className="entrant-head">
              <div>
                <div className="entrant-name" id={`ent-${e.id}`}>
                  {label} {e.status !== 'active' && <span className={`badge ${e.status}`} title={ENTRY_STATUS_LABEL[e.status]}>{e.status.toUpperCase()}</span>}
                </div>
                <div className="entrant-sub">
                  {team && `${members.map(playerName).join(', ')}. `}
                  {own && 'Own tee. '}
                  {!cell || cell.holesPlayed === 0 ? 'No scores yet' : `${formatToPar(cell.toPar)} thru ${cell.holesPlayed}`}
                </div>
              </div>
              {seg.method === 'best_ball' && (
                <div className={`entrant-score ${counts === null ? 'empty' : counts < par * seg.count ? 'under' : ''}`} aria-label={counts === null ? 'Team score not complete' : `Team score ${counts}`}>
                  {counts ?? '–'}
                  <span className="small" style={{ display: 'block', fontSize: '.7rem', fontWeight: 400 }}>counts</span>
                </div>
              )}
            </div>
            {lines.map((ln) => (
              <ScorePad key={cellKey(ln.slot)} bundle={bundle} slot={ln.slot} name={ln.name} par={par} label={ln.name ?? label}
                state={writer.cells[cellKey(ln.slot)]} disabled={!!blocked || (!isAdmin && e.status !== 'active')}
                onSet={(v) => void commit(ln.slot, v)}
                onTheirs={() => writer.acceptTheirs(ln.slot)}
                onMine={async () => {
                  const reason = await askReason()
                  if (reason !== null) writer.keepMine(ln.slot, reason)
                }} />
            ))}
          </section>
        )
      })}

      {bundle.sideGames.filter((g) => g.roundId === round.id && g.kind !== 'skins' && g.holes.includes(holeNo)).map((g) => (
        <section key={g.id} className="entrant contest" aria-label={`${g.name} on hole ${holeNo}`}>
          <div className="entrant-name">{g.name} <span className="muted small">hole {holeNo}</span></div>
          <p className="small muted" style={{ margin: '.2rem 0 0' }}>If someone in your group beats the current winner, pick them and save.</p>
          <HoleWinnersForm bundle={bundle} reload={reload} game={g} holes={[holeNo]} disabled={!!blocked}
            players={entries.flatMap((e) => entryPlayers(bundle, e)).map((p) => ({ id: p.id, label: playerName(p) }))} />
        </section>
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

/** Number pad for one score slot (a team/individual score, or one player's best-ball score). */
function ScorePad(props: {
  bundle: EventBundle
  slot: ScoreSlot
  /** Player name on best-ball holes; null for the entry's own score. */
  name: string | null
  label: string
  par: number
  state: CellState | undefined
  disabled: boolean
  onSet: (v: number | null) => void
  onTheirs: () => void
  onMine: () => void
}) {
  const { bundle, slot, state, par } = props
  const [other, setOther] = useState('')
  const [otherErr, setOtherErr] = useState<string | null>(null)
  const saved = slotScore(bundle, slot.roundId, slot.entryId, slot.playerId, slot.hole)
  const shown = state && (state.kind === 'saving' || state.kind === 'failed') ? state.value : saved?.strokes ?? null
  const choices = Array.from({ length: 6 }, (_, i) => par - 2 + i).filter((v) => v >= 1)
  const id = `o-${slot.entryId}-${slot.playerId ?? 'e'}`

  return (
    <div className={props.name ? 'pad-line' : undefined}>
      <div className="split" style={{ margin: '.4rem 0 .2rem' }}>
        <strong>{props.name ?? 'Score'}</strong>
        <span className={`pad-value num ${shown === null ? 'muted' : shown < par ? 'under' : ''}`} aria-label={shown === null ? 'No score' : `Score ${shown}`}>{shown ?? '–'}</span>
      </div>
      <div className="pad" role="group" aria-label={`Score for ${props.label} on hole ${slot.hole}`}>
        {choices.map((v) => (
          <button key={v} type="button" className={`${v === par ? 'par' : ''} ${shown === v ? 'on' : ''}`} aria-pressed={shown === v}
            disabled={props.disabled || state?.kind === 'saving'} onClick={() => props.onSet(v)}
            aria-label={`${v}${v === par ? ' (par)' : ''}`}>
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
          <label htmlFor={id} className="sr-only">Other score for {props.label}</label>
          <input id={id} type="text" inputMode="numeric" placeholder="Other" value={other} disabled={props.disabled}
            onChange={(e) => setOther(e.target.value.replace(/\D/g, '').slice(0, 2))} />
          <button className="btn small" type="submit" disabled={props.disabled || !other}>Set</button>
        </form>
        {saved && (
          <button className="btn quiet small" type="button" disabled={props.disabled || state?.kind === 'saving'} onClick={() => props.onSet(null)}>
            {props.name ? 'Clear (pick-up)' : 'Clear hole'}
          </button>
        )}
      </div>
      {otherErr && <div className="save-state failed" role="alert">{otherErr}</div>}
      <SaveState state={state} onRetry={props.onSet} onTheirs={props.onTheirs} onMine={props.onMine} />
    </div>
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
