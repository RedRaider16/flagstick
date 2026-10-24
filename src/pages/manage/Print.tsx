import { Link, useParams, useSearchParams } from 'react-router'
import { usePath } from '../../app/context'
import { useAccess, useBundle, useTitle } from '../../app/hooks'
import { ErrorNote, Loading, Notice } from '../../components/ui'
import { currentRound, entryPlayers, formatDate, formatOf, formatTeeTime, isTeamEvent, nameOf, roundGroups, roundHoles, teeOf } from '../../domain/derive'
import { playerName, type EventBundle, type Round } from '../../domain/types'
import { isPlayerHole } from '../../scoring/formats'
import { rotation } from '../../scoring/leaderboard'

function usePrintData() {
  const { eventId } = useParams()
  const { bundle, error } = useBundle(eventId)
  const access = useAccess(eventId)
  const [q] = useSearchParams()
  const n = Number(q.get('round'))
  const round = bundle ? bundle.rounds.find((r) => r.roundNumber === n) ?? currentRound(bundle) : null
  return { bundle, error, access, round }
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

const sortGroups = (b: EventBundle, round: Round) =>
  [...roundGroups(b, round.id)].sort((x, y) => (round.startType === 'shotgun' ? x.startingHole - y.startingHole : (x.teeTime ?? '').localeCompare(y.teeTime ?? '')) || x.name.localeCompare(y.name, undefined, { numeric: true }))

export function PrintPairings() {
  const { bundle: b, error, access, round } = usePrintData()
  useTitle('Pairings')
  if (error) return <ErrorNote error={error} />
  if (!b || !access || !round) return <Loading />
  if (access.role !== 'admin') return <Notice kind="warn">Admins only.</Notice>
  const shotgun = round.startType === 'shotgun'
  const tee = teeOf(b, round.teeId)
  return (
    <>
      <Toolbar b={b} />
      <h1>{b.event.name}: pairings{b.rounds.length > 1 ? `, round ${round.roundNumber}` : ''}</h1>
      <p>{formatDate(round.date)} at {b.course?.name}{tee ? `, ${tee.name} tees` : ''}. {formatOf(b, round)}. {shotgun ? 'Shotgun start.' : 'Tee times.'} Event code {b.event.publicCode}.</p>
      <table>
        <thead><tr><th>Group</th><th>{shotgun ? 'Start hole' : 'Time'}</th><th>{isTeamEvent(b) ? 'Teams' : 'Players'}</th></tr></thead>
        <tbody>
          {sortGroups(b, round).map((g) => (
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
  const { bundle: b, error, access, round } = usePrintData()
  useTitle('Scorecards')
  if (error) return <ErrorNote error={error} />
  if (!b || !access || !round) return <Loading />
  if (access.role !== 'admin') return <Notice kind="warn">Admins only.</Notice>
  const holesInfo = roundHoles(b, round)
  if (holesInfo.length !== 18) return <Notice kind="warn">Choose a tee with all 18 holes set up for this round first.</Notice>
  const isTeam = isTeamEvent(b)
  const playerLines = isTeam && round.segments.some((s) => s.method === 'best_ball')
  const groups = sortGroups(b, round)
  const hole = (n: number) => holesInfo.find((x) => x.number === n)!
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
              <span>{b.rounds.length > 1 ? `Round ${round.roundNumber}. ` : ''}{g.name}. Starts hole {g.startingHole}{g.teeTime ? ` at ${formatTeeTime(g.teeTime)}` : ''}. {formatDate(round.date)}</span>
            </div>
            {halves.map((holes, hi) => (
              <table key={hi} style={{ marginTop: '.4rem' }}>
                <thead>
                  <tr><th className="nm">Hole</th>{holes.map((h) => <th key={h}>{h}</th>)}<th>{hi === 0 ? 'Out' : 'In'}</th><th>{hi === 1 ? 'Total' : ''}</th></tr>
                  <tr><td className="nm">Yards</td>{holes.map((h) => <td key={h}>{hole(h).yardage ?? ''}</td>)}<td /><td /></tr>
                  <tr><td className="nm">Par</td>{holes.map((h) => <td key={h}>{hole(h).par}</td>)}<td>{holes.reduce((s, h) => s + hole(h).par, 0)}</td><td>{hi === 1 ? holesInfo.reduce((s, h) => s + h.par, 0) : ''}</td></tr>
                  <tr><td className="nm">SI</td>{holes.map((h) => <td key={h}>{hole(h).strokeIndex}</td>)}<td /><td /></tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const team = e.teamId ? b.teams.find((t) => t.id === e.teamId) : null
                    const own = !isTeam ? teeOf(b, entryPlayers(b, e)[0]?.teeId) : null
                    if (playerLines)
                      return [
                        ...entryPlayers(b, e).map((pl) => (
                          <tr key={`${e.id}-${pl.id}`}>
                            <td className="nm">{playerName(pl)}<div style={{ fontSize: '8pt' }}>{team?.name}</div></td>
                            {holes.map((h) => <td key={h} className={isPlayerHole(round.segments, h) ? 'blank' : 'shade'} />)}
                            <td className="blank" />
                            <td className="blank" />
                          </tr>
                        )),
                        <tr key={`${e.id}-team`}>
                          <td className="nm"><strong>Team score</strong></td>
                          {holes.map((h) => <td key={h} className="blank" />)}
                          <td className="blank" />
                          <td className="blank" />
                        </tr>,
                      ]
                    return (
                      <tr key={e.id}>
                        <td className="nm">
                          {isTeam ? team?.name : nameOf(b, e)}
                          {own && own.id !== round.teeId && <div style={{ fontSize: '8pt' }}>{own.name} tees</div>}
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
            <div className="small" style={{ marginTop: '.25rem' }}>{formatOf(b, round)}.{playerLines ? ' Best-ball holes: record each player\'s score; shaded cells take the team score only.' : ''} Holes are listed in playing order.</div>
          </div>
        )
      })}
    </>
  )
}
