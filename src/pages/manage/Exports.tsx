import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useApp, usePath } from '../../app/context'
import { useAction } from '../../app/hooks'
import { download, ErrorNote, ScopeTabs, slug } from '../../components/ui'
import { buildEventLeaderboard, currentRound, formatTeeTime, groupOfEntry, leaderboardScopes, nameOf, roundGroups, type Scope } from '../../domain/derive'
import { ENTRY_STATUS_LABEL } from '../../domain/types'
import { toCsv } from '../../scoring/csv'
import { formatToPar } from '../../scoring/leaderboard'
import { useManage } from './ManageLayout'

export function Exports() {
  const { bundle } = useManage()
  const { repo } = useApp()
  const p = usePath()
  const { busy, error, run } = useAction()
  const scopes = useMemo(() => leaderboardScopes(bundle), [bundle])
  const [scope, setScope] = useState<Scope>(scopes[0]?.scope ?? currentRound(bundle).id)
  const lb = useMemo(() => buildEventLeaderboard(bundle, scope), [bundle, scope])
  const scopeRounds = scope === 'overall' ? bundle.rounds : bundle.rounds.filter((r) => r.id === scope)
  const scopeTag = scope === 'overall' ? 'overall' : `round-${scopeRounds[0]?.roundNumber ?? 1}`
  const base = slug(bundle.event.name)
  const status = lb.final ? 'FINAL' : 'PROVISIONAL'
  const rows = lb.groups.flatMap((g) => g.rows.map((r) => ({ flight: g.name, r })))
  const multi = scopeRounds.length > 1
  const statusText = (s: keyof typeof ENTRY_STATUS_LABEL) => (s === 'active' ? '' : s.toUpperCase())

  const leaderboardCsv = () => {
    const out = rows.map(({ flight, r }) => [flight, r.positionLabel, r.name, statusText(r.status), formatToPar(r.toPar), r.status === 'active' ? r.thru : '', ...(multi ? r.rounds.map((c) => c.gross ?? '') : []), r.gross ?? '', r.tiebreakNote ?? '', status])
    download(`${base}-${scopeTag}-leaderboard-${status.toLowerCase()}.csv`,
      toCsv(['flight', 'position', 'name', 'status', 'to_par', 'thru', ...(multi ? scopeRounds.map((x) => `r${x.roundNumber}`) : []), 'gross', 'tiebreak', 'results'], out))
  }
  const scoresCsv = () => {
    const holes = Array.from({ length: 18 }, (_, i) => i + 1)
    const out = rows.flatMap(({ flight, r }) => r.rounds.map((c, i) => [flight, r.name, statusText(r.status), scopeRounds[i]?.roundNumber ?? '', ...holes.map((h) => c.holeScores.get(h) ?? ''), c.gross ?? '', formatToPar(c.toPar), status]))
    download(`${base}-${scopeTag}-hole-by-hole.csv`, toCsv(['flight', 'name', 'status', 'round', ...holes.map((h) => `h${h}`), 'gross', 'to_par', 'results'], out))
  }
  const pairingsCsv = () => {
    const out = bundle.rounds.flatMap((rd) => bundle.entries.map((e) => {
      const g = groupOfEntry(roundGroups(bundle, rd.id), e.id)
      return [rd.roundNumber, g?.name ?? '', g ? formatTeeTime(g.teeTime) : '', g?.startingHole ?? '', nameOf(bundle, e)]
    }).sort((a, b) => String(a[1]).localeCompare(String(b[1]), undefined, { numeric: true })))
    download(`${base}-pairings.csv`, toCsv(['round', 'group', 'time', 'starting_hole', 'entry'], out))
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
          <ScopeTabs label="Results for" options={scopes} value={scope} onChange={setScope} />
          <p className="small muted">Results files are labelled {lb.final ? 'final' : 'provisional'} in the file name and in a column. Team counting scores are exported; best-ball player scores are in the app.</p>
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
            {bundle.rounds.map((rd) => (
              <div key={rd.id} className="row">
                {bundle.rounds.length > 1 && <strong style={{ minWidth: '4.5rem' }}>Round {rd.roundNumber}</strong>}
                <Link className="btn" to={p(`manage/${bundle.event.id}/print/pairings?round=${rd.roundNumber}`)}>Pairings sheet</Link>
                <Link className="btn" to={p(`manage/${bundle.event.id}/print/scorecards?round=${rd.roundNumber}`)}>Scorecards</Link>
              </div>
            ))}
            <div><Link className="btn" to={p(`e/${bundle.event.publicCode}`)}>Leaderboard</Link> <span className="small muted">then use your browser's Print</span></div>
          </div>
        </section>
      </div>
    </>
  )
}
