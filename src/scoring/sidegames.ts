// Side games and prize money.
//
// Skins: on each hole, the lowest score wins a skin only if nobody ties it.
// With carryover, a tied hole's skin rolls into the next hole (in hole order
// 1–18, regardless of where groups started); unclaimed carryovers at the end are
// not won. A hole only counts once every playing entry has a score there, so a
// skin can't be "won" before the rest of the field has played the hole.
//
// Payouts: amounts by finishing place. Entries tied for places share the total
// of the places they cover equally (e.g. two tied for 2nd split 2nd + 3rd).
// Cents that don't divide evenly go to the first entries in display order.

export interface SkinsEntry {
  id: string
  name: string
  /** hole → score (gross or net counting score). */
  card: ReadonlyMap<number, number>
}

export interface SkinHole {
  hole: number
  /** Winner's entry id, or null for a tie / not yet complete. */
  winnerId: string | null
  /** Skins this hole is worth (1 + carried-over skins). */
  value: number
  low: number | null
  /** 'won' | 'tied' | 'open' (not every entry has a score yet). */
  state: 'won' | 'tied' | 'open'
}

export interface SkinsResult {
  holes: SkinHole[]
  /** entryId → skins won. */
  won: Map<string, number>
  totalSkins: number
  /** Purse per skin in cents (0 if no purse or no skins). */
  perSkinCents: number
  /** entryId → cents. */
  payouts: Map<string, number>
}

export function computeSkins(entries: SkinsEntry[], opts: { carryover: boolean; purseCents: number }): SkinsResult {
  const holes: SkinHole[] = []
  const won = new Map<string, number>()
  let carry = 0
  for (let hole = 1; hole <= 18; hole++) {
    const scores = entries.map((e) => [e.id, e.card.get(hole)] as const)
    const value = 1 + carry
    if (entries.length === 0 || scores.some(([, v]) => v === undefined)) {
      holes.push({ hole, winnerId: null, value, low: null, state: 'open' })
      // An unfinished hole stops carryover resolution beyond it from being final, but we still show later holes.
      continue
    }
    const low = Math.min(...scores.map(([, v]) => v!))
    const at = scores.filter(([, v]) => v === low)
    if (at.length === 1) {
      const id = at[0]![0]
      won.set(id, (won.get(id) ?? 0) + value)
      holes.push({ hole, winnerId: id, value, low, state: 'won' })
      carry = 0
    } else {
      holes.push({ hole, winnerId: null, value, low, state: 'tied' })
      carry = opts.carryover ? value : 0
    }
  }
  const totalSkins = [...won.values()].reduce((a, b) => a + b, 0)
  const perSkinCents = totalSkins > 0 && opts.purseCents > 0 ? Math.floor(opts.purseCents / totalSkins) : 0
  const payouts = new Map<string, number>()
  if (perSkinCents > 0) {
    let remainder = opts.purseCents - perSkinCents * totalSkins
    const order = [...won.entries()].sort((a, b) => b[1] - a[1])
    for (const [id, n] of order) {
      const extra = remainder > 0 ? 1 : 0
      remainder -= extra
      payouts.set(id, perSkinCents * n + extra)
    }
  }
  return { holes, won, totalSkins, perSkinCents, payouts }
}

export interface PlacedRow {
  entryId: string
  /** Numeric position (ties share it), or null if unranked. */
  position: number | null
}

/**
 * Split place money. `amounts[i]` pays place i+1. Returns entryId → cents.
 * Unranked rows get nothing.
 */
export function splitPayouts(rows: PlacedRow[], amounts: number[]): Map<string, number> {
  const out = new Map<string, number>()
  const ranked = rows.filter((r) => r.position !== null)
  const byPos = new Map<number, PlacedRow[]>()
  for (const r of ranked) byPos.set(r.position!, [...(byPos.get(r.position!) ?? []), r])
  for (const [pos, group] of [...byPos].sort((a, b) => a[0] - b[0])) {
    let pot = 0
    for (let p = pos; p < pos + group.length; p++) pot += amounts[p - 1] ?? 0
    if (pot <= 0) continue
    const each = Math.floor(pot / group.length)
    let rem = pot - each * group.length
    for (const r of group) {
      const extra = rem > 0 ? 1 : 0
      rem -= extra
      out.set(r.entryId, each + extra)
    }
  }
  return out
}

/** Closest to the pin / long drive: one winner per hole, each paid the per-hole amount. */
export interface HoleWinner {
  hole: number
  playerId: string | null
  entryId: string | null
  note: string
}

export function holePrizeTotals(winners: HoleWinner[], perHoleCents: number): Map<string, number> {
  const out = new Map<string, number>()
  if (perHoleCents <= 0) return out
  for (const w of winners) {
    const key = w.playerId ?? w.entryId
    if (key) out.set(key, (out.get(key) ?? 0) + perHoleCents)
  }
  return out
}
