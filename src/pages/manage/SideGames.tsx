import { useState } from 'react'
import { useApp } from '../../app/context'
import { useAction } from '../../app/hooks'
import { SideGamesPanel } from '../../components/SideGamesPanel'
import { ErrorNote, useReasonDialog } from '../../components/ui'
import type { SideGameInput } from '../../data/repo'
import { centsToDollars, dollarsToCents } from '../../domain/inputs'
import { nameOf, roundHoles } from '../../domain/derive'
import { formatMoney, playerName, SIDE_GAME_LABEL, type EventBundle, type Round, type SideGame, type SideGameKind } from '../../domain/types'
import { useManage } from './ManageLayout'

export function defaultGame(b: EventBundle, round: Round, kind: SideGameKind, sortOrder: number): SideGameInput {
  const holes = roundHoles(b, round)
  const par = (n: number) => holes.filter((h) => h.par === n).map((h) => h.number)
  return {
    kind,
    name: kind === 'skins' ? 'Skins' : SIDE_GAME_LABEL[kind],
    holes: kind === 'closest_to_pin' ? par(3) : kind === 'long_drive' ? par(5).slice(0, 2) : [],
    basis: 'gross',
    carryover: false,
    purseCents: 0,
    perHoleCents: 0,
    sortOrder,
  }
}

export function SideGames() {
  const { bundle, reload } = useManage()
  const { repo } = useApp()
  const { busy, error, run } = useAction()
  const dialog = useReasonDialog()
  const final = bundle.event.status === 'finalized'

  return (
    <>
      {dialog.element}
      <ErrorNote error={error} />
      <p>
        Side games run alongside the main competition. Skins are worked out from the scores automatically.
        For closest to the pin and long drive, you or a scorekeeper record each hole's winner (scorekeepers see the contest on that hole while entering scores).
      </p>
      {bundle.rounds.map((round) => {
        const games = bundle.sideGames.filter((g) => g.roundId === round.id)
        return (
          <section key={round.id} className="panel">
            <div className="split">
              <h2>{bundle.rounds.length > 1 ? `Round ${round.roundNumber}` : 'Side games'}</h2>
              <div className="row">
                {(['skins', 'closest_to_pin', 'long_drive'] as SideGameKind[]).map((k) => (
                  <button key={k} className="btn small" type="button" disabled={busy || final}
                    onClick={() => void run(async () => { await repo.createSideGame(bundle.event.id, round.id, defaultGame(bundle, round, k, bundle.sideGames.length + 1)); await reload() })}>
                    + {SIDE_GAME_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
            {games.length === 0 ? <p className="muted">No side games for this round.</p> : games.map((g) => (
              <GameEditor key={g.id + JSON.stringify(g)} game={g} round={round} disabled={busy || final}
                onSave={(input, entryIds) => run(async () => {
                  await repo.updateSideGame(g.id, input)
                  if (JSON.stringify(entryIds) !== JSON.stringify(g.entryIds)) await repo.setSideGameEntries(g.id, bundle.event.id, entryIds)
                  await reload()
                })}
                onDelete={async () => {
                  const ok = await dialog.ask({ title: `Delete ${g.name}?`, body: <p>Its recorded winners are deleted too.</p>, confirmLabel: 'Delete', danger: true })
                  if (ok !== null) await run(async () => { await repo.deleteSideGame(g.id); await reload() })
                }} />
            ))}
          </section>
        )
      })}
      {bundle.sideGames.length > 0 && <SideGamesPanel bundle={bundle} />}
    </>
  )
}

function GameEditor(props: { game: SideGame; round: Round; disabled: boolean; onSave: (g: SideGameInput, entryIds: string[]) => Promise<unknown>; onDelete: () => void }) {
  const { bundle } = useManage()
  const g = props.game
  const [f, setF] = useState<SideGameInput>({ kind: g.kind, name: g.name, holes: g.holes, basis: g.basis, carryover: g.carryover, purseCents: g.purseCents, perHoleCents: g.perHoleCents, sortOrder: g.sortOrder })
  const [money, setMoney] = useState(centsToDollars(g.kind === 'skins' ? g.purseCents : g.perHoleCents))
  const [everyone, setEveryone] = useState(g.entryIds.length === 0)
  const [entryIds, setEntryIds] = useState<string[]>(g.entryIds)
  const [err, setErr] = useState<string | null>(null)
  const holes = roundHoles(bundle, props.round)
  const id = `sg-${g.id}`
  const active = bundle.entries.filter((e) => e.status === 'active')

  return (
    <div className="round-card">
    <form onSubmit={(e) => {
      e.preventDefault()
      const c = dollarsToCents(money)
      if (c === 'bad') return setErr('Enter dollars, like 300 or 25.50.')
      if (f.kind !== 'skins' && f.holes.length === 0) return setErr('Pick at least one hole.')
      setErr(null)
      void props.onSave({ ...f, purseCents: f.kind === 'skins' ? c ?? 0 : 0, perHoleCents: f.kind === 'skins' ? 0 : c ?? 0 }, f.kind === 'skins' && !everyone ? entryIds : [])
    }}>
      <div className="split">
        <h3 style={{ margin: 0 }}>{SIDE_GAME_LABEL[g.kind]}</h3>
        <button className="btn quiet small" type="button" disabled={props.disabled} onClick={props.onDelete}>Delete</button>
      </div>
      <div className="grid-3">
        <div className="field">
          <label htmlFor={`${id}-n`}>Name</label>
          <input id={`${id}-n`} type="text" maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-m`}>{f.kind === 'skins' ? 'Total purse ($)' : 'Prize per hole ($)'}</label>
          <input id={`${id}-m`} type="text" inputMode="decimal" placeholder="None" value={money} onChange={(e) => setMoney(e.target.value)} />
          <span className="hint">{f.kind === 'skins' ? 'Split evenly across the skins won.' : 'Paid to each hole’s winner.'}</span>
        </div>
        {f.kind === 'skins' && (
          <div className="field">
            <label htmlFor={`${id}-b`}>Scores</label>
            <select id={`${id}-b`} value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value as 'gross' | 'net' })}>
              <option value="gross">Gross</option>
              <option value="net">Net</option>
            </select>
          </div>
        )}
      </div>
      {f.kind === 'skins' ? (
        <>
          <label className="choice">
            <input type="checkbox" checked={f.carryover} onChange={(e) => setF({ ...f, carryover: e.target.checked })} />
            <span>Carryover<span className="hint">A tied hole's skin carries to the next hole.</span></span>
          </label>
          <fieldset>
            <legend>Who's in</legend>
            <label className="choice"><input type="radio" checked={everyone} onChange={() => setEveryone(true)} /> <span>Everyone playing</span></label>
            <label className="choice"><input type="radio" checked={!everyone} onChange={() => setEveryone(false)} /> <span>Only those who bought in</span></label>
            {!everyone && (
              <div className="row" style={{ gap: '.2rem 1rem' }}>
                {active.map((e) => (
                  <label key={e.id} className="choice" style={{ padding: 0 }}>
                    <input type="checkbox" checked={entryIds.includes(e.id)} onChange={(ev) => setEntryIds(ev.target.checked ? [...entryIds, e.id] : entryIds.filter((x) => x !== e.id))} />
                    <span>{nameOf(bundle, e)}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        </>
      ) : (
        <fieldset>
          <legend>Holes</legend>
          <div className="hole-picks">
            {holes.map((h) => (
              <label key={h.number} className={`hole-pick ${f.holes.includes(h.number) ? 'on' : ''}`}>
                <input type="checkbox" checked={f.holes.includes(h.number)}
                  onChange={(e) => setF({ ...f, holes: e.target.checked ? [...f.holes, h.number].sort((a, b) => a - b) : f.holes.filter((x) => x !== h.number) })} />
                <span>{h.number}<small>par {h.par}</small></span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {err && <p className="small" role="alert" style={{ color: 'var(--danger)' }}>{err}</p>}
      <button className="btn primary small" type="submit" disabled={props.disabled}>Save</button>
    </form>
    {g.kind !== 'skins' && <HoleWinnersEditor game={g} disabled={props.disabled} />}
    </div>
  )
}

/** Record closest-to-the-pin / long-drive winners. Also used on the scoring screen. */
export function HoleWinnersEditor({ game, disabled, holes, players }: { game: SideGame; disabled: boolean; holes?: number[]; players?: { id: string; label: string }[] }) {
  const { bundle, reload } = useManage()
  return <HoleWinnersForm bundle={bundle} reload={reload} game={game} disabled={disabled} holes={holes} players={players} />
}

export function HoleWinnersForm(props: { bundle: EventBundle; reload: () => Promise<void>; game: SideGame; disabled: boolean; holes?: number[]; players?: { id: string; label: string }[] }) {
  const { bundle, game } = props
  const { repo } = useApp()
  const { busy, error, run } = useAction()
  const everyone = props.players ?? [...bundle.players].sort((a, b) => a.lastName.localeCompare(b.lastName)).map((p) => {
    const team = bundle.teams.find((t) => t.playerIds.includes(p.id))
    return { id: p.id, label: `${playerName(p)}${team ? ` (${team.name})` : ''}` }
  })
  const holes = props.holes ?? game.holes
  return (
    <div style={{ marginTop: '.8rem' }}>
      <ErrorNote error={error} />
      <table className="small">
        <thead><tr><th scope="col">Hole</th><th scope="col">Winner</th><th scope="col">{game.kind === 'closest_to_pin' ? 'Distance' : 'Note'}</th><th scope="col"><span className="sr-only">Save</span></th></tr></thead>
        <tbody>
          {holes.map((h) => (
            <WinnerRow key={`${h}-${JSON.stringify(bundle.sideGameResults.find((r) => r.gameId === game.id && r.hole === h) ?? null)}`} hole={h} game={game} bundle={bundle} options={everyone} disabled={props.disabled || busy}
              onSave={(playerId, note) => run(async () => { await repo.setSideGameResult(game.id, h, playerId, note); await props.reload() })} />
          ))}
        </tbody>
      </table>
      {game.perHoleCents > 0 && <p className="small muted">{formatMoney(game.perHoleCents)} to each hole's winner.</p>}
    </div>
  )
}

function WinnerRow(props: { hole: number; game: SideGame; bundle: EventBundle; options: { id: string; label: string }[]; disabled: boolean; onSave: (playerId: string | null, note: string) => Promise<unknown> }) {
  const cur = props.bundle.sideGameResults.find((r) => r.gameId === props.game.id && r.hole === props.hole)
  const [pid, setPid] = useState(cur?.playerId ?? '')
  const [note, setNote] = useState(cur?.note ?? '')
  const curName = cur?.playerId ? props.bundle.players.find((p) => p.id === cur.playerId) : null
  const opts = curName && !props.options.some((o) => o.id === cur!.playerId) ? [{ id: cur!.playerId!, label: playerName(curName) }, ...props.options] : props.options
  const dirty = pid !== (cur?.playerId ?? '') || note !== (cur?.note ?? '')
  return (
    <tr>
      <td className="num">{props.hole}</td>
      <td>
        <select aria-label={`Winner on hole ${props.hole}`} value={pid} disabled={props.disabled} onChange={(e) => setPid(e.target.value)} style={{ minHeight: 38 }}>
          <option value="">No winner yet</option>
          {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </td>
      <td><input aria-label={`Note for hole ${props.hole}`} type="text" maxLength={60} value={note} disabled={props.disabled} onChange={(e) => setNote(e.target.value)} placeholder={props.game.kind === 'closest_to_pin' ? `e.g. 6' 4"` : ''} style={{ width: 120, minHeight: 38 }} /></td>
      <td><button className="btn small" type="button" disabled={props.disabled || !dirty} onClick={() => void props.onSave(pid || null, note)}>Save</button></td>
    </tr>
  )
}
