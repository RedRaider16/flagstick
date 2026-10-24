// Net scoring. A player's Handicap Index is never used as strokes directly:
//
//   Course Handicap  = Index × Slope / 113 + (Course Rating − Par)   (WHS Rule 6.1, rounded)
//   Playing Handicap = Course Handicap × allowance %                  (rounded)
//
// Strokes are then given hole by hole using the stroke index (SI 1 first); a
// "plus" handicap gives strokes back starting from SI 18. This follows the
// published World Handicap System formulas, but Flagstick is not a handicap
// service: the Index, rating and slope are whatever the organizer entered, with
// the Index's source and date shown alongside results.
//
// Team allowances (organizer-adjustable; the defaults are the USGA's
// recommendations in Appendix C of the Rules of Handicapping):
//   individual stroke play     95%
//   best ball (four-ball)      85% of each player's Course Handicap
//   2-person scramble          35% low + 15% high
//   4-person scramble          25% / 20% / 15% / 10% (lowest to highest)
//   3-person scramble          20% / 15% / 10% (no USGA figure; a common club choice)
//   alternate shot             50% of the partners' combined Course Handicaps

import type { Method, Segment } from './formats'
import { segmentFor } from './formats'

export interface NetAllowances {
  individual: number
  bestBall: number
  /** Percent by player, lowest Course Handicap first, keyed by team size. */
  scramble: Record<number, number[]>
  altShot: number
}

export const DEFAULT_ALLOWANCES: NetAllowances = {
  individual: 95,
  bestBall: 85,
  scramble: { 2: [35, 15], 3: [20, 15, 10], 4: [25, 20, 15, 10] },
  altShot: 50,
}

/** WHS rounding: to the nearest whole number, .5 rounded up (toward the higher handicap). */
export const whsRound = (x: number) => Math.floor(x + 0.5)

export interface TeeRating {
  rating: number | null
  slope: number | null
  /** Total par of the 18 holes on this tee. */
  par: number
}

export type HandicapProblem = 'no_index' | 'no_rating'

/** Course Handicap, or why it can't be worked out. Index uses negative numbers for plus handicaps. */
export function courseHandicap(index: number | null | undefined, tee: TeeRating, maxIndex?: number | null): number | HandicapProblem {
  if (index === null || index === undefined) return 'no_index'
  if (tee.rating === null || tee.slope === null) return 'no_rating'
  const hi = maxIndex !== null && maxIndex !== undefined ? Math.min(index, maxIndex) : index
  return whsRound((hi * tee.slope) / 113 + (tee.rating - tee.par))
}

export const playingHandicap = (ch: number, pct: number) => whsRound((ch * pct) / 100)

/** Strokes received on a hole (negative = strokes given back by a plus handicap). */
export function strokesOnHole(ph: number, strokeIndex: number, holeCount = 18): number {
  if (ph >= 0) return Math.floor(ph / holeCount) + (strokeIndex <= ph % holeCount ? 1 : 0)
  const p = -ph
  const back = Math.floor(p / holeCount) + (strokeIndex > holeCount - (p % holeCount) ? 1 : 0)
  return back === 0 ? 0 : -back
}

/** Team Playing Handicap for a scramble: weighted sum, lowest Course Handicap gets the first weight. */
export function scrambleHandicap(chs: number[], weights: number[]): number {
  const sorted = [...chs].sort((a, b) => a - b)
  return whsRound(sorted.reduce((sum, ch, i) => sum + (ch * (weights[i] ?? 0)) / 100, 0))
}

export const altShotHandicap = (chs: number[], pct: number) => whsRound((chs.reduce((a, b) => a + b, 0) * pct) / 100)

/** Playing handicaps one entry uses in a round: per player (individual / best ball) and per team method. */
export interface EntryHandicaps {
  /** playerId → Playing Handicap for own-ball holes (individual or best ball). */
  players: Map<string, number>
  /** Team Playing Handicap by method (scramble, alternate shot). */
  team: Partial<Record<Method, number>>
}

export interface PlayerHcpInput {
  playerId: string
  /** Course Handicap on the tee this player plays, or the reason it's unknown. */
  courseHandicap: number | HandicapProblem
}

/**
 * Work out an entry's Playing Handicaps for the methods used in a round.
 * Returns the problem instead when any player lacks what's needed.
 */
export function entryHandicaps(segments: Segment[], players: PlayerHcpInput[], teamSize: number, a: NetAllowances): EntryHandicaps | HandicapProblem {
  for (const p of players) if (typeof p.courseHandicap === 'string') return p.courseHandicap
  const chs = players.map((p) => p.courseHandicap as number)
  const out: EntryHandicaps = { players: new Map(), team: {} }
  const methods = new Set(segments.map((s) => s.method))
  if (methods.has('individual')) for (const p of players) out.players.set(p.playerId, playingHandicap(p.courseHandicap as number, a.individual))
  if (methods.has('best_ball')) for (const p of players) out.players.set(p.playerId, playingHandicap(p.courseHandicap as number, a.bestBall))
  if (methods.has('scramble')) out.team.scramble = scrambleHandicap(chs, a.scramble[teamSize] ?? DEFAULT_ALLOWANCES.scramble[teamSize] ?? [])
  if (methods.has('alt_shot')) out.team.alt_shot = altShotHandicap(chs, a.altShot)
  return out
}

export interface RawHoleScore {
  playerId: string | null
  hole: number
  strokes: number
}

/**
 * Net counting score per hole for one entry in one round, mirroring
 * countingCards(): best ball takes the lowest N net player scores.
 */
export function netCard(segments: Segment[], scores: RawHoleScore[], hcp: EntryHandicaps, strokeIndex: ReadonlyMap<number, number>): Map<number, number> {
  const byHole = new Map<number, { entry?: number; players: Map<string, number> }>()
  for (const s of scores) {
    if (s.hole < 1 || s.hole > 18) continue
    const h = byHole.get(s.hole) ?? { players: new Map<string, number>() }
    byHole.set(s.hole, h)
    const seg = segmentFor(segments, s.hole)
    if (seg.method === 'best_ball') {
      if (s.playerId) h.players.set(s.playerId, s.strokes)
    } else if (!s.playerId) h.entry = s.strokes
  }
  const out = new Map<number, number>()
  for (const [hole, h] of byHole) {
    const seg = segmentFor(segments, hole)
    const si = strokeIndex.get(hole) ?? hole
    if (seg.method === 'best_ball') {
      const nets = [...h.players].map(([pid, g]) => g - strokesOnHole(hcp.players.get(pid) ?? 0, si)).sort((x, y) => x - y)
      if (nets.length >= seg.count) out.set(hole, nets.slice(0, seg.count).reduce((x, y) => x + y, 0))
    } else if (h.entry !== undefined) {
      const ph = seg.method === 'individual' ? [...hcp.players.values()][0] ?? 0 : hcp.team[seg.method] ?? 0
      out.set(hole, h.entry - strokesOnHole(ph, si))
    }
  }
  return out
}

/** Short description of the allowances used, for leaderboard footers. */
export function describeAllowances(segments: Segment[], teamSize: number, a: NetAllowances): string {
  const parts = new Set<string>()
  for (const s of segments) {
    if (s.method === 'individual') parts.add(`${a.individual}% of Course Handicap`)
    if (s.method === 'best_ball') parts.add(`best ball ${a.bestBall}%`)
    if (s.method === 'scramble') parts.add(`scramble ${(a.scramble[teamSize] ?? []).join('/')}%`)
    if (s.method === 'alt_shot') parts.add(`alternate shot ${a.altShot}% of combined`)
  }
  return [...parts].join(', ')
}

export const HANDICAP_PROBLEM_TEXT: Record<HandicapProblem, string> = {
  no_index: 'needs a Handicap Index',
  no_rating: 'tee needs a course rating and slope',
}
