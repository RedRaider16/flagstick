import { Link, NavLink, Navigate, Outlet, useOutletContext, useParams } from 'react-router'
import { usePath } from '../../app/context'
import { useAccess, useBundle, useTitle } from '../../app/hooks'
import { ErrorNote, Loading, StatusBadge } from '../../components/ui'
import type { Access } from '../../data/repo'
import { formatDate } from '../../domain/derive'
import { FORMAT_LABEL, type EventBundle } from '../../domain/types'

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

  const isTeam = bundle.round.format === 'scramble_2'
  const base = p(`manage/${bundle.event.id}`)
  const tabs: [string, string][] = [
    ['', 'Overview'],
    ['setup', 'Event & course'],
    ['players', 'Players'],
    ...(isTeam ? ([['teams', 'Teams']] as [string, string][]) : []),
    ['groups', 'Groups'],
    ['staff', 'Scorekeepers'],
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
            {formatDate(bundle.event.date)} at {bundle.course?.name ?? 'no course'}. {FORMAT_LABEL[bundle.round.format]}.
          </div>
        </div>
        <div className="row">
          <StatusBadge status={bundle.event.status} />
          {bundle.round.status === 'locked' && <span className="badge locked">Round locked</span>}
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
