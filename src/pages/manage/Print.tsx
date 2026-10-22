import { Link, useParams } from 'react-router'
import { usePath } from '../../app/context'
import { useAccess, useBundle, useTitle } from '../../app/hooks'
import { ErrorNote, Loading, Notice } from '../../components/ui'
import { formatDate, formatTeeTime, nameOf } from '../../domain/derive'
import { playerName, type EventBundle } from '../../domain/types'
import { rotation } from '../../scoring/leaderboard'

function usePrintData() {
  const { eventId } = useParams()
  const { bundle, error } = useBundle(eventId)
  const access = useAccess(eventId)
  return { bundle, error, access }
}

function Toolbar({ b }: { b: EventBundle }) {
  const p = usePath()
  return (
    <div className="row no-print" style={{ marginBottom: '1rem' }}>
      <Link className="btn quiet" to={p(`manage/${b.event.id}/exports`)}>Back</Link>
      <button className="btn primary" type="button" onClick={() => window.print()}>Print</button>
    </div>
  )
}

const sortGroups = (b: EventBundle) =>
  [...b.groups].sort((x, y) => (b.round.startType === 'shotgun' ? x.startingHole - y.startingHole : (x.teeTime ?? '').localeCompare(y.teeTime ?? '')) || x.name.localeCompare(y.name, undefined, { numeric: true }))

export function PrintPairings() {
  const { bundle: b, error, access } = usePrintData()
  useTitle('Pairings')
  if (error) return <ErrorNote error={error} />
  if (!b || !access) return <Loading />
  if (access.role !== 'admin') return <Notice kind="warn">Admins only.</Notice>
  const shotgun = b.round.startType === 'shotgun'
  return (
    <>
      <Toolbar b={b} />
      <h1>{b.event.name}: pairings</h1>
      <p>{formatDate(b.event.date)} at {b.course?.name}{b.tee ? `, ${b.tee.name} tees` : ''}. {shotgun ? 'Shotgun start.' : 'Tee times.'} Event code {b.event.publicCode}.</p>
      <table>
        <thead><tr><th>Group</th><th>{shotgun ? 'Start hole' : 'Time'}</th><th>{b.round.format === 'scramble_2' ? 'Teams' : 'Players'}</th></tr></thead>
        <tbody>
          {sortGroups(b).map((g) => (
            <tr key={g.id}>
              <td><strong>{g.name}</strong></td>
              <td className="num" style={{ fontSize: '1.1rem' }}>{shotgun ? `Hole ${g.startingHole}` : formatTeeTime(g.teeTime)}{!shotgun && g.startingHole !== 1 ? `, hole ${g.startingHole}` : ''}</td>
              <td>{g.entryIds.map((id) => b.entries.find((e) => e.id === id)).filter(Boolean).map((e) => nameOf(b, e!)).join('; ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export function PrintScorecards() {
  const { bundle: b, error, access } = usePrintData()
  useTitle('Scorecards')
  if (error) return <ErrorNote error={error} />
  if (!b || !access) return <Loading />
  if (access.role !== 'admin') return <Notice kind="warn">Admins only.</Notice>
  if (b.holes.length !== 18) return <Notice kind="warn">Set up the course holes first.</Notice>
  const isTeam = b.round.format === 'scramble_2'
  const groups = sortGroups(b)
  return (
    <>
      <Toolbar b={b} />
      {groups.length === 0 && <Notice kind="info">Create groups first.</Notice>}
      {groups.map((g, gi) => {
        const order = rotation(g.startingHole)
        const halves = [order.slice(0, 9), order.slice(9)]
        const entries = g.entryIds.map((id) => b.entries.find((e) => e.id === id)).filter((e) => !!e)
        return (
          <div key={g.id} className={`scorecard ${gi % 2 === 1 ? 'page-break' : ''}`}>
            <div className="split">
              <strong>{b.event.name}</strong>
              <span>{g.name}. Starts hole {g.startingHole}{g.teeTime ? ` at ${formatTeeTime(g.teeTime)}` : ''}. {formatDate(b.event.date)}</span>
            </div>
            {halves.map((holes, hi) => (
              <table key={hi} style={{ marginTop: '.4rem' }}>
                <thead>
                  <tr><th className="nm">Hole</th>{holes.map((h) => <th key={h}>{h}</th>)}<th>{hi === 0 ? 'Out' : 'In'}</th><th>{hi === 1 ? 'Total' : ''}</th></tr>
                  <tr><td className="nm">Yards</td>{holes.map((h) => <td key={h}>{b.holes.find((x) => x.number === h)?.yardage ?? ''}</td>)}<td /><td /></tr>
                  <tr><td className="nm">Par</td>{holes.map((h) => <td key={h}>{b.holes.find((x) => x.number === h)!.par}</td>)}<td>{holes.reduce((s, h) => s + b.holes.find((x) => x.number === h)!.par, 0)}</td><td>{hi === 1 ? b.holes.reduce((s, h) => s + h.par, 0) : ''}</td></tr>
                  <tr><td className="nm">SI</td>{holes.map((h) => <td key={h}>{b.holes.find((x) => x.number === h)!.strokeIndex}</td>)}<td /><td /></tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const team = e.teamId ? b.teams.find((t) => t.id === e.teamId) : null
                    return (
                      <tr key={e.id}>
                        <td className="nm">
                          {isTeam ? team?.name : nameOf(b, e)}
                          {isTeam && team && <div style={{ fontSize: '8pt' }}>{team.playerIds.map((id) => b.players.find((x) => x.id === id)).filter(Boolean).map((x) => playerName(x!)).join(' / ')}</div>}
                        </td>
                        {holes.map((h) => <td key={h} className="blank" />)}
                        <td className="blank" />
                        <td className="blank" />
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ))}
            <div className="split small" style={{ marginTop: '.5rem' }}>
              <span>Scorer: ____________________</span>
              <span>Attested: ____________________</span>
            </div>
            <div className="small" style={{ marginTop: '.25rem' }}>{isTeam ? 'Two-person scramble: one team score per hole.' : 'Individual stroke play: each player records their own score.'} Holes are listed in playing order.</div>
          </div>
        )
      })}
    </>
  )
}
