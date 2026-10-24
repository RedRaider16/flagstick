import { useMemo, useState } from 'react'
import { useApp } from '../../app/context'
import { useAction } from '../../app/hooks'
import { ErrorNote, Notice, useReasonDialog } from '../../components/ui'
import { buildEventLeaderboard, isTeamEvent, leaderboardScopes, nameOf, type Scope } from '../../domain/derive'
import type { EventBundle, Flight } from '../../domain/types'
import { flightsFromStandings } from '../../scoring/event'
import { formatToPar } from '../../scoring/leaderboard'
import { useManage } from './ManageLayout'

/** Standings without the flight split, for cutting new flights. */
function plainStandings(b: EventBundle, scope: Scope) {
  const flat = { ...b, rounds: b.rounds.map((r) => ({ ...r, useFlights: false })) }
  return buildEventLeaderboard(flat, scope).groups.flatMap((g) => g.rows)
}

export function Flights() {
  const { bundle, reload } = useManage()
  const { repo } = useApp()
  const { busy, error, run } = useAction()
  const dialog = useReasonDialog()
  const [newName, setNewName] = useState('')
  const final = bundle.event.status === 'finalized'
  const isTeam = isTeamEvent(bundle)
  const unit = isTeam ? 'team' : 'player'
  const flights = [...bundle.flights].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  const entries = [...bundle.entries].sort((a, b) => nameOf(bundle, a).localeCompare(nameOf(bundle, b)))
  const countIn = (fid: string | null) => bundle.entries.filter((e) => e.flightId === fid).length
  const usedBy = bundle.rounds.filter((r) => r.useFlights).map((r) => r.roundNumber)

  const move = (f: Flight, dir: -1 | 1) =>
    run(async () => {
      const i = flights.findIndex((x) => x.id === f.id)
      const other = flights[i + dir]
      if (!other) return
      await repo.updateFlight(f.id, f.name, other.sortOrder)
      await repo.updateFlight(other.id, other.name, f.sortOrder === other.sortOrder ? f.sortOrder + dir : f.sortOrder)
      await reload()
    })

  return (
    <>
      {dialog.element}
      <ErrorNote error={error} />
      <p>
        Flights split the field into divisions (Championship, First, Second…), each ranked on its own.{' '}
        {usedBy.length === 0
          ? <strong>No round ranks by flight yet — turn it on for each round under Event &amp; course.</strong>
          : <>Ranked by flight in round{usedBy.length > 1 ? 's' : ''} {usedBy.join(', ')}.</>}
      </p>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="panel">
          <h2>Flights</h2>
          {flights.length === 0 ? <p className="muted">No flights yet.</p> : (
            <ol className="flight-list">
              {flights.map((f, i) => (
                <li key={f.id} className="row">
                  <strong style={{ flex: 1 }}>{f.name}</strong>
                  <span className="small muted">{countIn(f.id)} {unit}{countIn(f.id) === 1 ? '' : 's'}</span>
                  <button className="btn quiet small" type="button" aria-label={`Move ${f.name} up`} disabled={busy || final || i === 0} onClick={() => void move(f, -1)}>↑</button>
                  <button className="btn quiet small" type="button" aria-label={`Move ${f.name} down`} disabled={busy || final || i === flights.length - 1} onClick={() => void move(f, 1)}>↓</button>
                  <button className="btn quiet small" type="button" disabled={busy || final} onClick={async () => {
                    const name = await dialog.ask({ title: `Rename ${f.name}`, label: 'Flight name', required: true, initial: f.name, confirmLabel: 'Rename' })
                    if (name) await run(async () => { await repo.updateFlight(f.id, name.trim(), f.sortOrder); await reload() })
                  }}>Rename</button>
                  <button className="btn quiet small" type="button" disabled={busy || final} onClick={async () => {
                    const ok = await dialog.ask({ title: `Delete ${f.name}?`, body: <p>Its {countIn(f.id)} {unit}s become unflighted. Scores aren't affected.</p>, confirmLabel: 'Delete flight', danger: true })
                    if (ok !== null) await run(async () => { await repo.deleteFlight(f.id); await reload() })
                  }}>Delete</button>
                </li>
              ))}
            </ol>
          )}
          <form className="row" onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              await repo.createFlight(bundle.event.id, newName.trim(), (flights[flights.length - 1]?.sortOrder ?? 0) + 1)
              setNewName('')
              await reload()
            })
          }}>
            <label htmlFor="fl-new" className="sr-only">New flight name</label>
            <input id="fl-new" type="text" maxLength={40} placeholder={flights.length === 0 ? 'Championship' : 'Flight name'} value={newName} onChange={(e) => setNewName(e.target.value)} style={{ flex: 1 }} />
            <button className="btn" type="submit" disabled={busy || final || !newName.trim()}>Add flight</button>
          </form>
          {countIn(null) > 0 && flights.length > 0 && <p className="small" style={{ marginTop: '.6rem' }}>{countIn(null)} {unit}{countIn(null) === 1 ? ' is' : 's are'} not in a flight.</p>}
        </section>

        {flights.length > 1 && <CutFromStandings flights={flights} disabled={busy || final} />}
      </div>

      {flights.length > 0 && (
        <section className="panel">
          <h2>Assign {unit}s</h2>
          {entries.length === 0 ? <p className="muted">No {unit}s yet.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">{isTeam ? 'Team' : 'Player'}</th><th scope="col">Flight</th></tr></thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td>{nameOf(bundle, e)}{e.status !== 'active' && <span className={`badge ${e.status}`} style={{ marginLeft: '.4rem' }}>{e.status.toUpperCase()}</span>}</td>
                      <td>
                        <select aria-label={`Flight for ${nameOf(bundle, e)}`} value={e.flightId ?? ''} disabled={busy || final} style={{ maxWidth: 260 }}
                          onChange={(ev) => void run(async () => { await repo.setEntryFlights(bundle.event.id, [{ entryId: e.id, flightId: ev.target.value || null }]); await reload() })}>
                          <option value="">No flight</option>
                          {flights.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  )
}

/** Cut flights by finishing order: e.g. Sunday flights from Saturday's results. */
function CutFromStandings({ flights, disabled }: { flights: Flight[]; disabled: boolean }) {
  const { bundle, reload } = useManage()
  const { repo } = useApp()
  const { busy, error, run } = useAction()
  const sources = leaderboardScopes(bundle).filter((s) => plainStandings(bundle, s.scope).some((r) => r.holesPlayed > 0))
  const [source, setSource] = useState<Scope | null>(null)
  const scope = source ?? sources[0]?.scope ?? null
  const standing = useMemo(() => (scope ? plainStandings(bundle, scope) : []), [bundle, scope])
  const ranked = standing.filter((r) => r.position !== null)
  const even = (n: number) => flights.map((_, i) => Math.floor(n / flights.length) + (i < n % flights.length ? 1 : 0))
  const [sizes, setSizes] = useState<number[] | null>(null)
  const sz = sizes && sizes.length === flights.length ? sizes : even(ranked.length)
  const plan = useMemo(() => flightsFromStandings(standing, flights.map((f, i) => ({ flightId: f.id, size: sz[i] ?? 0 }))), [standing, flights, sz])
  const [preview, setPreview] = useState(false)

  return (
    <section className="panel">
      <h2>Set flights from results</h2>
      <p className="small">Fill flights in finishing order — top finishers to the first flight. Teams tied at a cut line stay together in the higher flight. Unranked (WD, DQ, DNF, NS) entries are left as they are.</p>
      <ErrorNote error={error} />
      {sources.length === 0 ? <Notice kind="info">No results yet. Once a round has scores you can flight from it.</Notice> : (
        <>
          <div className="field">
            <label htmlFor="cut-src">Use the standings of</label>
            <select id="cut-src" value={scope ?? ''} onChange={(e) => { setSource(e.target.value); setSizes(null) }}>
              {sources.map((s) => <option key={s.scope} value={s.scope}>{s.label}</option>)}
            </select>
          </div>
          <div className="grid-3">
            {flights.map((f, i) => (
              <div className="field" key={f.id}>
                <label htmlFor={`cut-${f.id}`}>{f.name}{i === flights.length - 1 ? ' (the rest)' : ''}</label>
                <input id={`cut-${f.id}`} type="number" min={0} max={ranked.length} value={i === flights.length - 1 ? Math.max(0, ranked.length - sz.slice(0, -1).reduce((a, b) => a + b, 0)) : sz[i]}
                  disabled={i === flights.length - 1}
                  onChange={(e) => { const n = [...sz]; n[i] = Math.max(0, Number(e.target.value) || 0); setSizes(n) }} />
              </div>
            ))}
          </div>
          <div className="row">
            <button className="btn" type="button" onClick={() => setPreview(!preview)} aria-expanded={preview}>{preview ? 'Hide' : 'Preview'}</button>
            <button className="btn primary" type="button" disabled={disabled || busy || plan.length === 0}
              onClick={() => void run(async () => { await repo.setEntryFlights(bundle.event.id, plan); await reload() })}>
              Assign {plan.length} {isTeamEvent(bundle) ? 'teams' : 'players'}
            </button>
          </div>
          {preview && (
            <div className="table-wrap" style={{ marginTop: '.6rem' }}>
              <table>
                <thead><tr><th scope="col">Pos</th><th scope="col">Name</th><th scope="col" className="n">To par</th><th scope="col">New flight</th></tr></thead>
                <tbody>
                  {ranked.map((r) => (
                    <tr key={r.entryId}>
                      <td>{r.positionLabel}</td>
                      <td>{r.name}</td>
                      <td className="n">{formatToPar(r.toPar)}</td>
                      <td>{flights.find((f) => f.id === plan.find((x) => x.entryId === r.entryId)?.flightId)?.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}
