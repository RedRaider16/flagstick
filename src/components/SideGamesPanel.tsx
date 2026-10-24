// Read-only results of an event's side games: closest to the pin / long drive
// winners by hole, and skins worked out from the scores.
import { nameOf, skinsFor } from '../domain/derive'
import { formatMoney, playerName, SIDE_GAME_LABEL, type EventBundle, type SideGame } from '../domain/types'

export function SideGamesPanel({ bundle, showMoney = true }: { bundle: EventBundle; showMoney?: boolean }) {
  if (!bundle.sideGames.length) return null
  const multi = bundle.rounds.length > 1
  const money = showMoney && !bundle.event.hidePurse
  return (
    <section className="panel" aria-labelledby="sg-h">
      <h2 id="sg-h">Side games</h2>
      {bundle.sideGames.map((g) => (
        <div key={g.id} className="side-game">
          <h3>
            {g.name}
            <span className="muted small"> {multi ? `· Round ${bundle.rounds.find((r) => r.id === g.roundId)?.roundNumber ?? ''}` : ''}{g.kind === 'skins' ? ` · ${g.basis}${g.carryover ? ', carryover' : ''}` : ''}</span>
          </h3>
          {g.kind === 'skins' ? <Skins bundle={bundle} game={g} money={money} /> : <HoleWinners bundle={bundle} game={g} money={money} />}
        </div>
      ))}
    </section>
  )
}

function HoleWinners({ bundle, game, money }: { bundle: EventBundle; game: SideGame; money: boolean }) {
  const results = bundle.sideGameResults.filter((r) => r.gameId === game.id)
  if (!game.holes.length) return <p className="muted small">No holes chosen yet.</p>
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th scope="col">Hole</th><th scope="col">Winner</th><th scope="col">{game.kind === 'closest_to_pin' ? 'Distance' : 'Note'}</th>{money && game.perHoleCents > 0 && <th scope="col" className="n">Prize</th>}</tr></thead>
        <tbody>
          {game.holes.map((h) => {
            const r = results.find((x) => x.hole === h)
            const p = r?.playerId ? bundle.players.find((x) => x.id === r.playerId) : null
            const e = r?.entryId ? bundle.entries.find((x) => x.id === r.entryId) : null
            const team = e?.teamId ? bundle.teams.find((t) => t.id === e.teamId) : null
            return (
              <tr key={h}>
                <td className="num">{h}</td>
                <td>{p ? <>{playerName(p)}{team && <span className="muted small"> ({team.name})</span>}</> : <span className="muted">Not yet</span>}</td>
                <td>{r?.note ?? ''}</td>
                {money && game.perHoleCents > 0 && <td className="n num">{p ? formatMoney(game.perHoleCents) : ''}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Skins({ bundle, game, money }: { bundle: EventBundle; game: SideGame; money: boolean }) {
  const res = skinsFor(bundle, game)
  const name = (id: string) => {
    const e = bundle.entries.find((x) => x.id === id)
    return e ? nameOf(bundle, e) : '—'
  }
  const won = res.holes.filter((h) => h.state === 'won')
  const open = res.holes.filter((h) => h.state === 'open').length
  return (
    <>
      {won.length === 0 ? <p className="muted small">No skins won yet.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Hole</th><th scope="col">Won by</th><th scope="col" className="n">Score</th><th scope="col" className="n">Skins</th></tr></thead>
            <tbody>
              {won.map((h) => (
                <tr key={h.hole}><td className="num">{h.hole}</td><td>{name(h.winnerId!)}</td><td className="n num">{h.low}</td><td className="n num">{h.value}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {money && res.totalSkins > 0 && res.perSkinCents > 0 && (
        <p className="small">
          {formatMoney(game.purseCents)} ÷ {res.totalSkins} skin{res.totalSkins === 1 ? '' : 's'} = {formatMoney(res.perSkinCents)} each.{' '}
          {[...res.payouts].map(([id, c]) => `${name(id)} ${formatMoney(c)}`).join('; ')}
        </p>
      )}
      <p className="small muted">
        {open > 0 ? `${open} hole${open === 1 ? '' : 's'} still open — a hole is decided once everyone in the game has a score there. ` : ''}
        {res.excluded.size > 0 && `${res.excluded.size} entr${res.excluded.size === 1 ? 'y' : 'ies'} can't play net skins yet (${[...new Set(res.excluded.values())].join('; ')}).`}
      </p>
    </>
  )
}

export { SIDE_GAME_LABEL }
