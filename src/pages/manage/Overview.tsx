import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useApp, usePath } from '../../app/context'
import { useAction } from '../../app/hooks'
import { Leaderboard } from '../../components/Leaderboard'
import { ErrorNote, Notice, useReasonDialog } from '../../components/ui'
import { buildLeaderboard } from '../../domain/derive'
import type { EventStatus, StaffMember } from '../../domain/types'
import { finalizationBlockers } from '../../scoring/leaderboard'
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
  const lb = useMemo(() => buildLeaderboard(bundle), [bundle])
  const { event, round } = bundle
  const isTeam = round.format === 'scramble_2'

  useEffect(() => {
    repo.startBlockers(event.id).then(setBlockers, () => setBlockers([]))
    repo.listStaff(event.id).then(setStaff, () => setStaff([]))
  }, [repo, event.id, bundle])

  const idx = STEPS.findIndex((s) => s.key === event.status)
  const unassigned = bundle.entries.filter((e) => !bundle.groups.some((g) => g.entryIds.includes(e.id))).length
  const scorekeepers = staff.filter((s) => s.role === 'scorekeeper')
  const finalBlockers = finalizationBlockers(lb)
  const act = (fn: () => Promise<void>) => run(async () => { await fn(); await reload() })

  const spectatorUrl = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}${p(`e/${event.publicCode}`)}`

  const checklist: [boolean, string, string][] = [
    [!!bundle.tee && bundle.holes.length === 18, bundle.tee ? `${bundle.tee.name} tees, ${bundle.holes.length} of 18 holes set up` : 'Choose a tee', 'setup'],
    [bundle.players.length > 0, `${bundle.players.length} player${bundle.players.length === 1 ? '' : 's'}`, 'players'],
    ...(isTeam
      ? ([[bundle.teams.length > 0 && bundle.teams.every((t) => t.playerIds.length === 2), `${bundle.teams.length} team${bundle.teams.length === 1 ? '' : 's'}${bundle.teams.some((t) => t.playerIds.length !== 2) ? ', some without two players' : ''}`, 'teams']] as [boolean, string, string][])
      : []),
    [bundle.groups.length > 0 && unassigned === 0, bundle.groups.length ? `${bundle.groups.length} groups${unassigned ? `, ${unassigned} ${isTeam ? 'team' : 'player'}${unassigned === 1 ? '' : 's'} not in a group` : ''}` : 'No groups yet', 'groups'],
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

        {event.status === 'draft' && (
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
              {round.status === 'locked'
                ? 'The round is locked. Scorekeepers can no longer change scores; admins can correct with a reason.'
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
                  const r = await dialog.ask({ title: 'Lock the round?', body: <p>Scorekeepers will no longer be able to change scores. You can unlock it later.</p>, label: 'Note', confirmLabel: 'Lock round' })
                  if (r !== null) await act(() => repo.setRoundLock(round.id, true, r))
                }}>Lock round</button>
              ) : (
                <button className="btn" disabled={busy} onClick={async () => {
                  const r = await dialog.ask({ title: 'Unlock the round?', body: <p>Scorekeepers will be able to change scores again.</p>, label: 'Reason', confirmLabel: 'Unlock round' })
                  if (r !== null) await act(() => repo.setRoundLock(round.id, false, r))
                }}>Unlock round</button>
              )}
              <button className="btn primary" disabled={busy || finalBlockers.length > 0} onClick={async () => {
                const r = await dialog.ask({
                  title: 'Finalize results?',
                  body: <p>Results will be marked Final and nobody can change scores. You can reopen later; reopening is recorded.</p>,
                  label: 'Note', confirmLabel: 'Finalize results',
                })
                if (r !== null) await act(() => repo.finalizeRound(round.id, r))
              }}>Finalize results</button>
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
            <button className="btn" disabled={busy} onClick={async () => {
              const r = await dialog.ask({
                title: 'Reopen final results?',
                body: <p>The round reopens locked, so only admins can make corrections. Your name, the time and the reason are recorded.</p>,
                label: 'Reason', required: true, confirmLabel: 'Reopen', danger: true,
              })
              if (r !== null) await act(() => repo.reopenRound(round.id, r))
            }}>Reopen results</button>
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

      {bundle.holes.length === 18 && (
        <Leaderboard lb={lb} holes={bundle.holes} title={isTeam ? 'Team leaderboard' : 'Leaderboard'} isTeam={isTeam} showGaps />
      )}
    </>
  )
}
