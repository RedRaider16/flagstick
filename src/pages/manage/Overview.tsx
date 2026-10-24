import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useApp, usePath } from '../../app/context'
import { useAction } from '../../app/hooks'
import { EventBoard } from '../../components/EventBoard'
import { SideGamesPanel } from '../../components/SideGamesPanel'
import { ErrorNote, Notice, useReasonDialog } from '../../components/ui'
import { buildEventLeaderboard, currentRound, isTeamEvent, roundGroups, roundHoles, teeOf, teeHoles } from '../../domain/derive'
import type { EventStatus, StaffMember } from '../../domain/types'
import type { EventLeaderboard } from '../../scoring/event'
import { useManage } from './ManageLayout'

const STEPS: { key: EventStatus; label: string }[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'published', label: 'Published' },
  { key: 'in_progress', label: 'Scoring' },
  { key: 'finalized', label: 'Final' },
]

export function Overview() {
  const { bundle, reload } = useManage()
  const { repo } = useApp()
  const p = usePath()
  const { busy, error, run } = useAction()
  const dialog = useReasonDialog()
  const nav = useNavigate()
  const [blockers, setBlockers] = useState<string[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const { event } = bundle
  const round = currentRound(bundle)
  const multi = bundle.rounds.length > 1
  const isTeam = isTeamEvent(bundle)
  const roundLb = useMemo(() => buildEventLeaderboard(bundle, round.id), [bundle, round.id])
  const rLabel = multi ? `round ${round.roundNumber}` : 'the round'

  useEffect(() => {
    repo.startBlockers(event.id).then(setBlockers, () => setBlockers([]))
    repo.listStaff(event.id).then(setStaff, () => setStaff([]))
  }, [repo, event.id, bundle])

  const idx = STEPS.findIndex((s) => s.key === event.status)
  const roundGs = roundGroups(bundle, round.id)
  const unassigned = bundle.entries.filter((e) => e.status === 'active' && !roundGs.some((g) => g.entryIds.includes(e.id))).length
  const scorekeepers = staff.filter((s) => s.role === 'scorekeeper')
  const finalBlockers = roundBlockers(roundLb)
  const act = (fn: () => Promise<void>) => run(async () => { await fn(); await reload() })

  const spectatorUrl = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}${p(`e/${event.publicCode}`)}`

  const checklist: [boolean, string, string][] = [
    ...bundle.rounds.map((r): [boolean, string, string] => {
      const tee = teeOf(bundle, r.teeId)
      const n = teeHoles(bundle, r.teeId).length
      const pre = multi ? `Round ${r.roundNumber}: ` : ''
      return [!!tee && n === 18, tee ? `${pre}${tee.name} tees${n === 18 ? '' : `, ${n} of 18 holes set up`}` : `${pre}choose a tee`, 'setup']
    }),
    [bundle.players.length > 0, `${bundle.players.length} player${bundle.players.length === 1 ? '' : 's'}`, 'players'],
    ...(isTeam
      ? ([[bundle.teams.length > 0 && bundle.teams.every((t) => t.playerIds.length === event.teamSize), `${bundle.teams.length} team${bundle.teams.length === 1 ? '' : 's'}${bundle.teams.some((t) => t.playerIds.length !== event.teamSize) ? `, some without ${event.teamSize} players` : ''}`, 'teams']] as [boolean, string, string][])
      : []),
    ...(bundle.flights.length > 0
      ? ([[bundle.entries.every((e) => e.status !== 'active' || e.flightId), `${bundle.flights.length} flights${bundle.entries.some((e) => e.status === 'active' && !e.flightId) ? `, some ${isTeam ? 'teams' : 'players'} not in a flight` : ''}`, 'flights']] as [boolean, string, string][])
      : []),
    [roundGs.length > 0 && unassigned === 0, roundGs.length ? `${multi ? `Round ${round.roundNumber}: ` : ''}${roundGs.length} groups${unassigned ? `, ${unassigned} ${isTeam ? 'team' : 'player'}${unassigned === 1 ? '' : 's'} not in a group` : ''}` : 'No groups yet', 'groups'],
    [scorekeepers.length > 0, scorekeepers.length ? `${scorekeepers.length} scorekeeper${scorekeepers.length === 1 ? '' : 's'}` : 'No scorekeepers (admins can still enter every score)', 'staff'],
  ]

  return (
    <>
      {dialog.element}
      <ErrorNote error={error} />
      <section className="panel">
        <h2>Event status</h2>
        <ol className="track" aria-label="Event status">
          {STEPS.map((s, i) => (
            <li key={s.key} className={`${i < idx ? 'done' : ''} ${i === idx ? `current ${s.key === 'finalized' ? 'final' : ''}` : ''}`} aria-current={i === idx ? 'step' : undefined}>
              {s.label}
            </li>
          ))}
        </ol>

        {event.isTemplate && (
          <>
            <p>This is a template: the saved setup for an annual event. It can't be published or scored.</p>
            <div className="row">
              <Link className="btn primary" to={p(`new?from=${event.id}`)}>Create this year's event</Link>
              <Link className="btn quiet" to={p(`manage/${event.id}/setup#copy`)}>Quick copy</Link>
            </div>
          </>
        )}

        {event.status === 'draft' && !event.isTemplate && (
          <>
            <p>Only staff can see this event. Publishing shows the pairings and leaderboard to anyone with the code.</p>
            <div className="row">
              <button className="btn primary" disabled={busy} onClick={() => act(() => repo.setEventStatus(event.id, 'published', ''))}>Publish</button>
              <button className="btn danger" disabled={busy} onClick={async () => {
                const ok = await dialog.ask({ title: 'Delete this draft event?', body: <p>Players, teams and groups in it are removed. This can't be undone.</p>, confirmLabel: 'Delete event', danger: true })
                if (ok !== null) await run(async () => { await repo.deleteEvent(event.id); nav(p('/')) })
              }}>Delete draft</button>
            </div>
          </>
        )}

        {event.status === 'published' && (
          <>
            <p>Spectators can see pairings. Start scoring when groups are ready to tee off.</p>
            {blockers.length > 0 && (
              <Notice kind="warn">Before scoring can start:<ul>{blockers.map((b) => <li key={b}>{b}</li>)}</ul></Notice>
            )}
            <div className="row">
              <button className="btn primary" disabled={busy || blockers.length > 0} onClick={() => act(() => repo.setEventStatus(event.id, 'in_progress', ''))}>Start scoring</button>
              <button className="btn quiet" disabled={busy} onClick={() => act(() => repo.setEventStatus(event.id, 'draft', ''))}>Back to draft</button>
            </div>
          </>
        )}

        {event.status === 'in_progress' && (
          <>
            <p>
              {multi && <><strong>Round {round.roundNumber} of {bundle.rounds.length}</strong> ({bundle.rounds.filter((r) => r.status === 'finalized').length} final). </>}
              {round.status === 'locked'
                ? `${multi ? 'Round ' + round.roundNumber : 'The round'} is locked. Scorekeepers can no longer change scores; admins can correct with a reason.`
                : 'Scorekeepers can enter scores for their groups.'}
            </p>
            {finalBlockers.length > 0 && (
              <details>
                <summary>{finalBlockers.length} entr{finalBlockers.length === 1 ? 'y needs' : 'ies need'} attention before finalizing</summary>
                <ul className="small">{finalBlockers.map((b) => <li key={b}>{b}</li>)}</ul>
              </details>
            )}
            <div className="row" style={{ marginTop: '.75rem' }}>
              {round.status === 'open' ? (
                <button className="btn" disabled={busy} onClick={async () => {
                  const r = await dialog.ask({ title: `Lock ${rLabel}?`, body: <p>Scorekeepers will no longer be able to change scores. You can unlock it later.</p>, label: 'Note', confirmLabel: 'Lock' })
                  if (r !== null) await act(() => repo.setRoundLock(round.id, true, r))
                }}>Lock {rLabel}</button>
              ) : (
                <button className="btn" disabled={busy} onClick={async () => {
                  const r = await dialog.ask({ title: `Unlock ${rLabel}?`, body: <p>Scorekeepers will be able to change scores again.</p>, label: 'Reason', confirmLabel: 'Unlock' })
                  if (r !== null) await act(() => repo.setRoundLock(round.id, false, r))
                }}>Unlock {rLabel}</button>
              )}
              <button className="btn primary" disabled={busy || finalBlockers.length > 0} onClick={async () => {
                const r = await dialog.ask({
                  title: multi ? `Finalize round ${round.roundNumber}?` : 'Finalize results?',
                  body: <p>{multi ? `Round ${round.roundNumber}'s scores become final and can't be changed. ${bundle.rounds.filter((r) => r.status !== 'finalized').length > 1 ? 'Scoring then moves to the next round.' : 'This is the last round, so the event becomes Final.'}` : 'Results will be marked Final and nobody can change scores.'} You can reopen later; reopening is recorded.</p>,
                  label: 'Note', confirmLabel: 'Finalize',
                })
                if (r !== null) await act(() => repo.finalizeRound(round.id, r))
              }}>{multi ? `Finalize round ${round.roundNumber}` : 'Finalize results'}</button>
              <button className="btn quiet" disabled={busy} onClick={async () => {
                const r = await dialog.ask({ title: 'Pause scoring?', body: <p>Moves the event back to Published. Scorekeepers can't enter scores until you start again.</p>, label: 'Reason', required: true, confirmLabel: 'Pause scoring' })
                if (r !== null) await act(() => repo.setEventStatus(event.id, 'published', r))
              }}>Pause scoring</button>
            </div>
          </>
        )}

        {event.status === 'finalized' && (
          <>
            <p>Results are final. Scores can't be changed by anyone.</p>
            <div className="row">
            {[...bundle.rounds].reverse().map((rd) => (
            <button key={rd.id} className="btn" disabled={busy} onClick={async () => {
              const r = await dialog.ask({
                title: 'Reopen final results?',
                body: <p>The round reopens locked, so only admins can make corrections. Your name, the time and the reason are recorded.</p>,
                label: 'Reason', required: true, confirmLabel: 'Reopen', danger: true,
              })
              if (r !== null) await act(() => repo.reopenRound(rd.id, r))
            }}>{multi ? `Reopen round ${rd.roundNumber}` : 'Reopen results'}</button>
            ))}
            </div>
          </>
        )}
      </section>

      <div className="grid-2">
        <section className="panel">
          <h2>Setup checklist</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {checklist.map(([ok, text, link]) => (
              <li key={link} className="row" style={{ padding: '.35rem 0' }}>
                <span aria-hidden="true" style={{ color: ok ? 'var(--ok)' : 'var(--pending)', fontWeight: 700, width: '1.2rem' }}>{ok ? '✓' : '○'}</span>
                <span className="sr-only">{ok ? 'Done:' : 'To do:'}</span>
                <Link to={p(`manage/${event.id}/${link}`)}>{text}</Link>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <h2>Share with spectators</h2>
          <p>Event code <span className="code-chip">{event.publicCode}</span></p>
          <p className="small" style={{ wordBreak: 'break-all' }}>{spectatorUrl}</p>
          <div className="row">
            <button className="btn" type="button" onClick={() => void navigator.clipboard?.writeText(spectatorUrl)}>Copy link</button>
            <Link className="btn quiet" to={p(`e/${event.publicCode}`)}>Open leaderboard</Link>
            {event.status === 'in_progress' && <Link className="btn quiet" to={p(`score/${event.id}`)}>Enter scores</Link>}
          </div>
          {event.status === 'draft' && <p className="small muted" style={{ marginTop: '.5rem' }}>The link works once the event is published.</p>}
        </section>
      </div>

      {roundHoles(bundle, round).length === 18 && (
        <>
          <EventBoard bundle={bundle} showGaps />
          <SideGamesPanel bundle={bundle} />
        </>
      )}
    </>
  )
}

/** Active entries without a full card in this round (finalizing needs none). */
function roundBlockers(lb: EventLeaderboard): string[] {
  return lb.groups.flatMap((g) => g.rows)
    .filter((r) => r.status === 'active' && !r.complete)
    .map((r) => `${r.name}: ${r.holesPlayed === 0 ? 'no scores' : `${18 - r.holesPlayed} hole(s) missing`}. Finish the card or mark WD, DNF or NS.`)
}
