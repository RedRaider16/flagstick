// Gross stroke-play leaderboard. Used for individual stroke play and for two-person
// scramble (where each entry is a team with one score per hole). See docs/SCORING.md.

import type { EntryStatus, TiebreakPolicy } from '../domain/types'
import { cardBack } from './tiebreak'

export interface LbHole {
  number: number
  par: number
}

export interface LbEntry {
  id: string
  name: string
  status: EntryStatus
  /** Starting hole of the entry's group; 1 if unassigned. */
  startingHole: number
}

export interface LbInput {
  holes: LbHole[]
  entries: LbEntry[]
  /** entryId → (hole → strokes). Holes with no score are simply absent. */
  scores: ReadonlyMap<string, ReadonlyMap<number, number>>
  tiebreak: TiebreakPolicy
  final: boolean
}

export interface LbRow {
  entryId: string
  name: string
  status: EntryStatus
  /** Numeric position, or null if unranked (no scores, WD, DQ). */
  position: number | null
  /** Display label: "1", "T3", "WD", "DQ", "—". */
  positionLabel: string
  tied: boolean
  gross: number | null
  toPar: number | null
  holesPlayed: number
  complete: boolean
  startingHole: number
  /** Holes skipped within the played rotation — needs scorekeeper attention. */
  gaps: number[]
  /** Set when card-back separated this entry from a tie. */
  tiebreakNote: string | null
  holeScores: Map<number, number>
}

export interface Leaderboard {
  rows: LbRow[]
  final: boolean
  tiebreak: TiebreakPolicy
  /** Tied groups that card-back could not separate (only when policy is card_back). */
  unresolvedTies: string[][]
}

/** Holes in the order a group starting on `start` plays them. */
export function rotation(start: number, holeCount = 18): number[] {
  const s = start >= 1 && start <= holeCount ? start : 1
  return Array.from({ length: holeCount }, (_, i) => ((s - 1 + i) % holeCount) + 1)
}

/** Holes missing between the start and the furthest hole scored along the rotation. */
export function findGaps(start: number, scored: ReadonlySet<number>, holeCount = 18): number[] {
  const order = rotation(start, holeCount)
  let last = -1
  order.forEach((h, i) => {
    if (scored.has(h)) last = i
  })
  if (last < 0) return []
  return order.slice(0, last + 1).filter((h) => !scored.has(h))
}

export function formatToPar(n: number | null): string {
  if (n === null) return '—'
  if (n === 0) return 'E'
  return n > 0 ? `+${n}` : String(n)
}

export function formatThru(row: Pick<LbRow, 'complete' | 'holesPlayed' | 'startingHole'>): string {
  if (row.complete) return 'F'
  if (row.holesPlayed === 0) return '—'
  return `${row.holesPlayed}${row.startingHole !== 1 ? '*' : ''}`
}

export function computeLeaderboard(input: LbInput): Leaderboard {
  const parByHole = new Map(input.holes.map((h) => [h.number, h.par]))
  const holeCount = input.holes.length

  const base: LbRow[] = input.entries.map((e) => {
    const raw = input.scores.get(e.id) ?? new Map<number, number>()
    const holeScores = new Map<number, number>()
    for (const [hole, strokes] of raw) if (parByHole.has(hole)) holeScores.set(hole, strokes)

    let gross = 0
    let par = 0
    for (const [hole, strokes] of holeScores) {
      gross += strokes
      par += parByHole.get(hole)!
    }
    const holesPlayed = holeScores.size
    return {
      entryId: e.id,
      name: e.name,
      status: e.status,
      position: null,
      positionLabel: '—',
      tied: false,
      gross: holesPlayed ? gross : null,
      toPar: holesPlayed ? gross - par : null,
      holesPlayed,
      complete: holeCount > 0 && holesPlayed === holeCount,
      startingHole: e.startingHole,
      gaps: findGaps(e.startingHole, new Set(holeScores.keys()), holeCount || 18),
      tiebreakNote: null,
      holeScores,
    }
  })

  const ranked = base.filter((r) => r.status === 'active' && r.holesPlayed > 0)
  const notStarted = base.filter((r) => r.status === 'active' && r.holesPlayed === 0)
  const out = base.filter((r) => r.status !== 'active')

  const cosmetic = (a: LbRow, b: LbRow) => b.holesPlayed - a.holesPlayed || a.name.localeCompare(b.name)
  ranked.sort((a, b) => a.toPar! - b.toPar! || cosmetic(a, b))

  // Group by to-par, then optionally break ties with matching scorecards.
  const groups: LbRow[][] = []
  for (const r of ranked) {
    const g = groups[groups.length - 1]
    if (g && g[0]!.toPar === r.toPar) g.push(r)
    else groups.push([r])
  }

  const unresolvedTies: string[][] = []
  const finalOrder: LbRow[][] = []
  for (const g of groups) {
    if (g.length > 1 && input.tiebreak === 'card_back' && g.every((r) => r.complete)) {
      const res = cardBack(g, (r) => r.holeScores)
      for (const sub of res.order) {
        sub.sort(cosmetic)
        finalOrder.push(sub)
        if (sub.length > 1) unresolvedTies.push(sub.map((r) => r.entryId))
      }
      for (const r of g) {
        const step = res.decidedBy.get(r)
        if (step) r.tiebreakNote = `Separated on ${step}`
      }
    } else {
      finalOrder.push(g)
    }
  }

  let pos = 1
  for (const g of finalOrder) {
    for (const r of g) {
      r.position = pos
      r.tied = g.length > 1
      r.positionLabel = `${g.length > 1 ? 'T' : ''}${pos}`
    }
    pos += g.length
  }

  notStarted.sort((a, b) => a.name.localeCompare(b.name))
  out.sort((a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name))
  for (const r of out) r.positionLabel = r.status.toUpperCase()

  return {
    rows: [...finalOrder.flat(), ...notStarted, ...out],
    final: input.final,
    tiebreak: input.tiebreak,
    unresolvedTies,
  }
}

/** Reasons the round can't be finalized yet (empty = OK to finalize). */
export function finalizationBlockers(lb: Leaderboard): string[] {
  const problems: string[] = []
  for (const r of lb.rows) {
    if (r.status !== 'active') continue
    if (!r.complete) {
      const missing = r.holesPlayed === 0 ? 'no scores' : `${18 - r.holesPlayed} hole(s) missing`
      problems.push(`${r.name}: ${missing}. Finish the card or mark WD/DQ.`)
    }
  }
  return problems
}
