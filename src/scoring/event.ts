// Event leaderboards: one or more rounds, optionally split by flight.
//
//   * Each round's counting cards come from formats.ts (countingCards).
//   * Overall = sum of every round played; a card counts as complete only when
//     every round is complete.
//   * With flights, positions are ranked within each flight (standard competition
//     ranking: T2, T2, 4), as Golf Genius does.
//   * WD, DQ, DNF and NS are unranked and listed last; their scores don't matter.
//   * Matching scorecards (if chosen) use the last round's card, per USGA CP 5A(6).

import type { EntryStatus, TiebreakPolicy } from '../domain/types'
import { computeLeaderboard, formatThru, type LbHole, type LbRow } from './leaderboard'
import { cardBack } from './tiebreak'

export interface EvRound {
  id: string
  number: number
  /** Par for the counting score on the round's tee (best 2 balls on a par 4 = 8). */
  holes: LbHole[]
  /** entryId → hole → counting score. */
  cards: ReadonlyMap<string, ReadonlyMap<number, number>>
  /** entryId → starting hole of its group this round. */
  startingHole?: ReadonlyMap<string, number>
  /** entryId → counting par by hole, for entries on a different tee. */
  entryPars?: ReadonlyMap<string, ReadonlyMap<number, number>>
}

export interface EvEntry {
  id: string
  name: string
  status: EntryStatus
  flightId: string | null
  /** Why this entry can't be ranked on this leaderboard (e.g. net without a Handicap Index). */
  excluded?: string
}

export interface EvFlight {
  id: string
  name: string
}

export interface EvInput {
  rounds: EvRound[]
  entries: EvEntry[]
  flights: EvFlight[]
  /** Split into flights (ignored when there are no flights). */
  byFlight: boolean
  tiebreak: TiebreakPolicy
  final: boolean
}

export interface EvRoundCell {
  roundId: string
  gross: number | null
  toPar: number | null
  holesPlayed: number
  complete: boolean
  gaps: number[]
  startingHole: number
  holeScores: Map<number, number>
}

export interface EvRow {
  entryId: string
  name: string
  status: EntryStatus
  flightId: string | null
  position: number | null
  positionLabel: string
  tied: boolean
  gross: number | null
  toPar: number | null
  holesPlayed: number
  complete: boolean
  /** "F", "12", "7*" for the round in play. */
  thru: string
  rounds: EvRoundCell[]
  tiebreakNote: string | null
  /** Set when the entry is listed but can't be ranked here. */
  note: string | null
}

export interface EvGroup {
  flightId: string | null
  /** Flight name, or '' when the leaderboard isn't split. */
  name: string
  rows: EvRow[]
  unresolvedTies: string[][]
}

export interface EventLeaderboard {
  groups: EvGroup[]
  final: boolean
  tiebreak: TiebreakPolicy
}

export const NO_FLIGHT = 'No flight'

export function computeEventLeaderboard(input: EvInput): EventLeaderboard {
  const perRound: Map<string, LbRow>[] = input.rounds.map((r) => {
    const lb = computeLeaderboard({
      holes: r.holes,
      entries: input.entries.map((e) => ({
        id: e.id,
        name: e.name,
        status: e.status,
        startingHole: r.startingHole?.get(e.id) ?? 1,
        pars: r.entryPars?.get(e.id),
      })),
      scores: r.cards,
      tiebreak: 'share',
      final: false,
    })
    return new Map(lb.rows.map((row) => [row.entryId, row]))
  })

  const rows: EvRow[] = input.entries.map((e) => {
    const cells: EvRoundCell[] = input.rounds.map((r, i) => {
      const x = perRound[i]!.get(e.id)!
      return {
        roundId: r.id,
        gross: x.gross,
        toPar: x.toPar,
        holesPlayed: x.holesPlayed,
        complete: x.complete,
        gaps: x.gaps,
        startingHole: x.startingHole,
        holeScores: x.holeScores,
      }
    })
    const played = cells.filter((c) => c.holesPlayed > 0)
    const holesPlayed = cells.reduce((a, c) => a + c.holesPlayed, 0)
    const complete = cells.length > 0 && cells.every((c) => c.complete)
    // The round in play: the latest one with scores (or the first, if none).
    const current = [...cells].reverse().find((c) => c.holesPlayed > 0) ?? cells[0]
    const thru = complete ? 'F' : current ? formatThru(current) : '—'
    return {
      entryId: e.id,
      name: e.name,
      status: e.status,
      flightId: e.flightId,
      position: null,
      positionLabel: '—',
      tied: false,
      gross: played.length ? played.reduce((a, c) => a + c.gross!, 0) : null,
      toPar: played.length ? played.reduce((a, c) => a + c.toPar!, 0) : null,
      holesPlayed,
      complete,
      thru,
      rounds: cells,
      tiebreakNote: null,
      note: e.excluded ?? null,
    }
  })

  const split = input.byFlight && input.flights.length > 0
  const groups: EvGroup[] = []
  if (split) {
    const known = new Set(input.flights.map((f) => f.id))
    for (const f of input.flights) groups.push(rank(rows.filter((r) => r.flightId === f.id), f.id, f.name))
    const loose = rows.filter((r) => !r.flightId || !known.has(r.flightId))
    if (loose.length) groups.push(rank(loose, null, NO_FLIGHT))
  } else {
    groups.push(rank(rows, null, ''))
  }
  return { groups, final: input.final, tiebreak: input.tiebreak }

  function rank(list: EvRow[], flightId: string | null, name: string): EvGroup {
    const ranked = list.filter((r) => r.status === 'active' && !r.note && r.holesPlayed > 0)
    const notStarted = list.filter((r) => r.status === 'active' && !r.note && r.holesPlayed === 0)
    const excluded = list.filter((r) => r.status === 'active' && r.note)
    const out = list.filter((r) => r.status !== 'active')
    const cosmetic = (a: EvRow, b: EvRow) => b.holesPlayed - a.holesPlayed || a.name.localeCompare(b.name)
    ranked.sort((a, b) => a.toPar! - b.toPar! || cosmetic(a, b))

    const ties: EvRow[][] = []
    for (const r of ranked) {
      const g = ties[ties.length - 1]
      if (g && g[0]!.toPar === r.toPar) g.push(r)
      else ties.push([r])
    }
    const last = input.rounds.length - 1
    const unresolvedTies: string[][] = []
    const order: EvRow[][] = []
    for (const g of ties) {
      if (g.length > 1 && input.tiebreak === 'card_back' && last >= 0 && g.every((r) => r.complete)) {
        const res = cardBack(g, (r) => r.rounds[last]!.holeScores)
        for (const sub of res.order) {
          sub.sort(cosmetic)
          order.push(sub)
          if (sub.length > 1) unresolvedTies.push(sub.map((r) => r.entryId))
        }
        for (const r of g) {
          const step = res.decidedBy.get(r)
          if (step) r.tiebreakNote = `Separated on ${step}${input.rounds.length > 1 ? ` of round ${input.rounds[last]!.number}` : ''}`
        }
      } else order.push(g)
    }
    let pos = 1
    for (const g of order) {
      for (const r of g) {
        r.position = pos
        r.tied = g.length > 1
        r.positionLabel = `${g.length > 1 ? 'T' : ''}${pos}`
      }
      pos += g.length
    }
    notStarted.sort((a, b) => a.name.localeCompare(b.name))
    const statusOrder: EntryStatus[] = ['dnf', 'ns', 'wd', 'dq']
    out.sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status) || a.name.localeCompare(b.name))
    for (const r of out) r.positionLabel = r.status.toUpperCase()
    excluded.sort((a, b) => a.name.localeCompare(b.name))
    return { flightId, name, rows: [...order.flat(), ...notStarted, ...excluded, ...out], unresolvedTies }
  }
}

export interface FlightCut {
  flightId: string
  /** How many entries go in this flight; the last flight takes the rest. */
  size: number
}

/**
 * Assign flights from standings (e.g. Sunday flights from Saturday's results).
 * `standing` is ranked rows in finishing order. Entries tied at a cut stay together
 * in the higher flight. Unranked entries are left out (assign them by hand).
 */
export function flightsFromStandings(
  standing: Pick<EvRow, 'entryId' | 'position'>[],
  cuts: FlightCut[],
): { entryId: string; flightId: string }[] {
  const ranked = standing.filter((r) => r.position !== null)
  const out: { entryId: string; flightId: string }[] = []
  let i = 0
  cuts.forEach((cut, ci) => {
    const isLast = ci === cuts.length - 1
    let taken = 0
    while (i < ranked.length) {
      if (!isLast && taken >= cut.size && ranked[i]!.position !== ranked[i - 1]?.position) break
      out.push({ entryId: ranked[i]!.entryId, flightId: cut.flightId })
      i++
      taken++
    }
  })
  return out
}
