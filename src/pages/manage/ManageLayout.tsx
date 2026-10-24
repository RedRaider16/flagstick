import { Link, NavLink, Navigate, Outlet, useOutletContext, useParams } from 'react-router'
import { usePath } from '../../app/context'
import { useAccess, useBundle, useTitle } from '../../app/hooks'
import { ErrorNote, Loading, StatusBadge } from '../../components/ui'
import type { Access } from '../../data/repo'
import { eventDates, eventFormatText, isTeamEvent } from '../../domain/derive'
import type { EventBundle } from '../../domain/types'

export interface ManageCtx {
  bundle: EventBundle
  access: Access
  reload: () => Promise<void>
}
export const useManage = () => useOutletContext<ManageCtx>()

export function ManageLayout() {
  const { eventId } = useParams()
  const p = usePath()
  const { bundle, error, reload } = useBundle(eventId)
  const access = useAccess(eventId)
  useTitle(bundle?.event.name ?? 'Event')

  if (error) return <ErrorNote error={error} />
  if (!bundle || !access) return <Loading />
  if (access.role === 'scorekeeper') return <Navigate to={p(`score/${bundle.event.id}`)} replace />
  if (access.role !== 'admin')
    return (
      <>
        <h1>{bundle.event.name}</h1>
        <p>Only this event's administrators can manage it.</p>
        {bundle.event.status !== 'draft' && <Link className="btn" to={p(`e/${bundle.event.publicCode}`)}>View the leaderboard</Link>}
      </>
    )

  const isTeam = isTeamEvent(bundle)
  const base = p(`manage/${bundle.event.id}`)
  const tabs: [string, string][] = [
    ['', 'Overview'],
    ['setup', 'Event & course'],
    ['registration', 'Registration'],
    ['players', 'Players'],
    ...(isTeam ? ([['teams', 'Teams']] as [string, string][]) : []),
    ['flights', 'Flights'],
    ['groups', 'Groups'],
    ['staff', 'Scorekeepers'],
    ['side-games', 'Side games'],
    ['payouts', 'Payouts'],
    ['scores', 'Scores'],
    ['history', 'History'],
    ['exports', 'Export & print'],
  ]

  return (
    <>
      <div className="event-head">
        <div>
          <h1>{bundle.event.name}</h1>
          <div className="event-meta">
            {eventDates(bundle)} at {bundle.course?.name ?? 'no course'}. {eventFormatText(bundle)}.
          </div>
        </div>
        <div className="row">
          {bundle.event.isTemplate ? <span className="badge provisional">Template</span> : <StatusBadge status={bundle.event.status} />}
          {bundle.rounds.filter((r) => r.status === 'locked').map((r) => <span key={r.id} className="badge locked">Round {r.roundNumber} locked</span>)}
          <span className="code-chip" title="Event code for spectators">{bundle.event.publicCode}</span>
        </div>
      </div>
      <nav className="tabs" aria-label="Event sections">
        {tabs.map(([path, label]) => (
          <NavLink key={path} to={path ? `${base}/${path}` : base} end={!path} className={({ isActive }) => (isActive ? 'active' : '')}>
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet context={{ bundle, access, reload } satisfies ManageCtx} />
    </>
  )
}
