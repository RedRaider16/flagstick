import { useMemo, useState } from 'react'
import { useApp } from '../../app/context'
import { useAction } from '../../app/hooks'
import { download, ErrorNote, Notice, slug } from '../../components/ui'
import { basesOf, buildEventLeaderboard, leaderboardPayouts, leaderboardScopes, nameOf, skinsFor, type Basis, type Scope } from '../../domain/derive'
import { formatMoney, playerName, type EventBundle } from '../../domain/types'
import { toCsv } from '../../scoring/csv'
import { holePrizeTotals } from '../../scoring/sidegames'
import { useManage } from './ManageLayout'

/** "600, 300, 150" ⇄ cents. */
export function parseAmounts(text: string): number[] | 'bad' {
  const parts = text.split(/[,\s]+/).map((x) => x.replace(/\$/g, '')).filter(Boolean)
  const out: number[] = []
  for (const p of parts) {
    if (!/^\d+(\.\d{1,2})?$/.test(p)) return 'bad'
    out.push(Math.round(Number(p) * 100))
  }
  return out
}
export const formatAmounts = (cents: number[]) => cents.map((c) => (c / 100).toFixed(2).replace(/\.00$/, '')).join(', ')

/** The competitions an event pays: basis × scope × flight. */
export function payoutSlots(b: EventBundle): { basis: Basis; scope: Scope; roundId: string | null; flightId: string | null; label: string }[] {
  const scopes = leaderboardScopes(b).filter((s) => (b.event.cumulative && b.rounds.length > 1 ? s.scope === 'overall' : true))
  const out: { basis: Basis; scope: Scope; roundId: string | null; flightId: string | null; label: string }[] = []
  for (const basis of basesOf(b.event.scoringBasis))
    for (const s of scopes) {
      const rounds = s.scope === 'overall' ? b.rounds : b.rounds.filter((r) => r.id === s.scope)
      const flighted = b.flights.length > 0 && rounds.some((r) => r.useFlights)
      const roundId = s.scope === 'overall' || b.rounds.length === 1 ? null : s.scope
      const scopeLabel = b.rounds.length === 1 ? '' : s.scope === 'overall' ? 'Overall' : s.label
      const prefix = [basesOf(b.event.scoringBasis).length > 1 ? (basis === 'gross' ? 'Gross' : 'Net') : '', scopeLabel].filter(Boolean).join(' · ')
      if (flighted) for (const f of b.flights) out.push({ basis, scope: s.scope, roundId, flightId: f.id, label: [prefix, f.name].filter(Boolean).join(' · ') })
      else out.push({ basis, scope: s.scope, roundId, flightId: null, label: prefix || 'Whole field' })
    }
  return out
}

export function Payouts() {
  const { bundle, reload } = useManage()
  const { repo } = useApp()
  const { busy, error, run } = useAction()
  const slots = payoutSlots(bundle)
  const final = bundle.event.status === 'finalized'
  const initial = Object.fromEntries(slots.map((s) => [key(s), formatAmounts(bundle.payouts.find((t) => t.basis === s.basis && t.roundId === s.roundId && t.flightId === s.flightId)?.amountsCents ?? [])]))
  const [text, setText] = useState<Record<string, string>>(initial)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const dirty = JSON.stringify(text) !== JSON.stringify(initial)
  const winnings = useMemo(() => totalWinnings(bundle), [bundle])
  const totalPurse = slots.reduce((sum, s) => sum + sumOf(text[key(s)] ?? ''), 0)
  const sideTotal = bundle.sideGames.reduce((a, g) => a + (g.kind === 'skins' ? g.purseCents : g.perHoleCents * g.holes.length), 0)

  return (
    <>
      <section className="panel">
        <h2>Place money</h2>
        <p className="small">Enter the amount for each finishing place, separated by commas: <code>600, 300, 150</code> pays 1st, 2nd and 3rd. Ties share the places they cover (two tied for 2nd split 2nd + 3rd). Team amounts are per team.</p>
        {bundle.event.hidePurse && <Notice kind="info">Prize money is hidden from spectators (Event &amp; course → Scoring).</Notice>}
        <ErrorNote error={error ?? err} />
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Competition</th><th scope="col">Amounts by place ($)</th><th scope="col" className="n">Total</th></tr></thead>
            <tbody>
              {slots.map((s) => (
                <tr key={key(s)}>
                  <th scope="row" style={{ fontWeight: 600 }}>{s.label}</th>
                  <td><input aria-label={`Amounts for ${s.label}`} type="text" inputMode="decimal" value={text[key(s)] ?? ''} disabled={final} placeholder="e.g. 600, 300, 150"
                    onChange={(e) => { setText({ ...text, [key(s)]: e.target.value }); setSaved(false) }} /></td>
                  <td className="n num">{formatMoney(sumOf(text[key(s)] ?? '')) || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><th scope="row">Total place money</th><td /><td className="n num">{formatMoney(totalPurse) || '$0.00'}</td></tr></tfoot>
          </table>
        </div>
        <div className="row" style={{ marginTop: '.6rem' }}>
          <button className="btn primary" type="button" disabled={busy || final || !dirty} onClick={() => {
            for (const s of slots) if (parseAmounts(text[key(s)] ?? '') === 'bad') return setErr(`${s.label}: use dollar amounts separated by commas, like 600, 300, 150.`)
            setErr(null)
            void run(async () => {
              for (const s of slots) {
                const cents = parseAmounts(text[key(s)] ?? '') as number[]
                await repo.savePayoutTable(bundle.event.id, { basis: s.basis, roundId: s.roundId, flightId: s.flightId, amountsCents: cents })
              }
              await reload()
              setSaved(true)
            })
          }}>Save payouts</button>
          {saved && !dirty && <span role="status" style={{ color: 'var(--ok)', fontWeight: 600 }}>Saved</span>}
          {sideTotal > 0 && <span className="small muted">Side games add {formatMoney(sideTotal)} (set on the Side games tab).</span>}
        </div>
      </section>

      <section className="panel">
        <div className="split">
          <h2>{final ? 'Winnings' : 'Projected winnings'}</h2>
          <button className="btn" type="button" disabled={!winnings.length} onClick={() => download(`${slug(bundle.event.name)}-winnings${final ? '' : '-projected'}.csv`,
            toCsv(['name', 'competition', 'amount', 'results'], winnings.flatMap((w) => w.items.map((i) => [w.name, i.what, (i.cents / 100).toFixed(2), final ? 'FINAL' : 'PROJECTED']))))}>Export CSV</button>
        </div>
        {!final && <p className="small muted">Follows the current standings and recorded side-game winners; it changes as scores come in.</p>}
        {winnings.length === 0 ? <p className="muted">Nothing paid yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Name</th><th scope="col">For</th><th scope="col" className="n">Total</th></tr></thead>
              <tbody>
                {winnings.map((w) => (
                  <tr key={w.id}>
                    <td>{w.name}</td>
                    <td className="small">{w.items.map((i) => `${i.what} ${formatMoney(i.cents)}`).join('; ')}</td>
                    <td className="n num">{formatMoney(w.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

const key = (s: { basis: string; roundId: string | null; flightId: string | null }) => `${s.basis}|${s.roundId ?? ''}|${s.flightId ?? ''}`
const sumOf = (t: string) => {
  const a = parseAmounts(t)
  return a === 'bad' ? 0 : a.reduce((x, y) => x + y, 0)
}

/** Everyone's winnings: place money from each paid leaderboard plus side games. */
export function totalWinnings(b: EventBundle): { id: string; name: string; total: number; items: { what: string; cents: number }[] }[] {
  const by = new Map<string, { name: string; items: { what: string; cents: number }[] }>()
  const add = (id: string, name: string, what: string, cents: number) => {
    if (cents <= 0) return
    const cur = by.get(id) ?? { name, items: [] }
    cur.items.push({ what, cents })
    by.set(id, cur)
  }
  const entryName = (id: string) => {
    const e = b.entries.find((x) => x.id === id)
    return e ? nameOf(b, e) : 'Unknown'
  }
  const seen = new Set<string>()
  for (const s of payoutSlots(b)) {
    const k = `${s.basis}|${s.scope}`
    if (seen.has(k)) continue
    seen.add(k)
    const lb = buildEventLeaderboard(b, s.scope, s.basis)
    const pay = leaderboardPayouts(b, lb, s.basis, s.scope)
    for (const g of lb.groups)
      for (const r of g.rows) {
        const c = pay.get(r.entryId)
        if (c) add(r.entryId, entryName(r.entryId), [basesOf(b.event.scoringBasis).length > 1 ? s.basis : '', s.scope === 'overall' || b.rounds.length === 1 ? '' : `R${b.rounds.find((x) => x.id === s.scope)?.roundNumber}`, g.name, r.positionLabel].filter(Boolean).join(' '), c)
      }
  }
  for (const g of b.sideGames) {
    if (g.kind === 'skins') {
      const res = skinsFor(b, g)
      res.payouts.forEach((c, id) => add(id, entryName(id), `${g.name} (${res.won.get(id)} skin${res.won.get(id) === 1 ? '' : 's'})`, c))
    } else {
      const totals = holePrizeTotals(b.sideGameResults.filter((r) => r.gameId === g.id), g.perHoleCents)
      totals.forEach((c, pid) => {
        const p = b.players.find((x) => x.id === pid)
        add(pid, p ? playerName(p) : 'Unknown', g.name, c)
      })
    }
  }
  return [...by].map(([id, v]) => ({ id, name: v.name, items: v.items, total: v.items.reduce((a, i) => a + i.cents, 0) })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
}
