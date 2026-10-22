import { useMemo } from 'react'
import { Link } from 'react-router'
import { useApp, usePath } from '../../app/context'
import { useAction } from '../../app/hooks'
import { download, ErrorNote, slug } from '../../components/ui'
import { buildLeaderboard, formatTeeTime, groupOfEntry, nameOf } from '../../domain/derive'
import { toCsv } from '../../scoring/csv'
import { formatThru, formatToPar } from '../../scoring/leaderboard'
import { useManage } from './ManageLayout'

export function Exports() {
  const { bundle } = useManage()
  const { repo } = useApp()
  const p = usePath()
  const { busy, error, run } = useAction()
  const lb = useMemo(() => buildLeaderboard(bundle), [bundle])
  const base = slug(bundle.event.name)
  const status = lb.final ? 'FINAL' : 'PROVISIONAL'
  const holeNums = bundle.holes.map((h) => h.number)

  const leaderboardCsv = () => {
    const rows = lb.rows.map((r) => [r.positionLabel, r.name, r.status.toUpperCase(), formatToPar(r.toPar), formatThru(r), r.gross ?? '', r.tiebreakNote ?? '', status])
    download(`${base}-leaderboard-${status.toLowerCase()}.csv`, toCsv(['position', 'name', 'status', 'to_par', 'thru', 'gross', 'tiebreak', 'results'], rows))
  }
  const scoresCsv = () => {
    const rows = lb.rows.map((r) => [r.name, r.status.toUpperCase(), ...holeNums.map((h) => r.holeScores.get(h) ?? ''), r.gross ?? '', formatToPar(r.toPar), status])
    download(`${base}-hole-by-hole.csv`, toCsv(['name', 'status', ...holeNums.map((h) => `h${h}`), 'gross', 'to_par', 'results'], rows))
  }
  const pairingsCsv = () => {
    const rows = bundle.entries.map((e) => {
      const g = groupOfEntry(bundle.groups, e.id)
      return [g?.name ?? '', g ? formatTeeTime(g.teeTime) : '', g?.startingHole ?? '', nameOf(bundle, e)]
    }).sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }))
    download(`${base}-pairings.csv`, toCsv(['group', 'time', 'starting_hole', 'entry'], rows))
  }
  const rosterCsv = () =>
    run(async () => {
      const contacts = await repo.listContacts(bundle.event.id)
      const rows = bundle.players.map((pl) => {
        const c = contacts.find((x) => x.playerId === pl.id)
        const team = bundle.teams.find((t) => t.playerIds.includes(pl.id))
        return [pl.firstName, pl.lastName, c?.email ?? '', c?.phone ?? '', team?.name ?? '']
      })
      download(`${base}-roster-PRIVATE.csv`, toCsv(['first_name', 'last_name', 'email', 'phone', 'team'], rows))
    })

  return (
    <>
      <ErrorNote error={error} />
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="panel">
          <h2>CSV downloads</h2>
          <p className="small muted">Results files are labelled {lb.final ? 'final' : 'provisional'} in the file name and in a column.</p>
          <div className="stack">
            <div><button className="btn" type="button" onClick={leaderboardCsv}>Leaderboard</button></div>
            <div><button className="btn" type="button" onClick={scoresCsv}>Hole-by-hole scores</button></div>
            <div><button className="btn" type="button" onClick={pairingsCsv}>Pairings</button></div>
            <div>
              <button className="btn" type="button" disabled={busy} onClick={() => void rosterCsv()}>Roster with contact details</button>
              <span className="small muted" style={{ display: 'block', marginTop: '.25rem' }}>Contains emails and phone numbers. Don't share it publicly.</span>
            </div>
          </div>
        </section>
        <section className="panel">
          <h2>Print</h2>
          <div className="stack">
            <div><Link className="btn" to={p(`manage/${bundle.event.id}/print/pairings`)}>Pairings sheet</Link></div>
            <div><Link className="btn" to={p(`manage/${bundle.event.id}/print/scorecards`)}>Scorecards, one per group</Link></div>
            <div><Link className="btn" to={p(`e/${bundle.event.publicCode}`)}>Leaderboard</Link> <span className="small muted">then use your browser's Print</span></div>
          </div>
        </section>
      </div>
    </>
  )
}
