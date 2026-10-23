// Round formats. A round is a list of segments, each a run of holes with one
// scoring method. This mirrors segments_problem() in the database.
//
//   individual  one score per player (individual events)
//   scramble    one team score per hole
//   alt_shot    one team score per hole (alternate shot)
//   best_ball   every player scores; the lowest `count` scores count
//
// Examples from the annual events:
//   2-person scramble    [{1–18 scramble}]
//   3-man 2 low ball     [{1–18 best_ball, count 2}] with team size 3
//   the 666 (Saturday)   [{1–6 scramble}, {7–12 alt_shot}, {13–18 best_ball, count 1}]

export type Method = 'individual' | 'scramble' | 'alt_shot' | 'best_ball'

export interface Segment {
  from: number
  to: number
  method: Method
  /** Scores that count per hole (best ball only; 1 otherwise). */
  count: number
}

export const METHOD_LABEL: Record<Method, string> = {
  individual: 'Stroke play',
  scramble: 'Scramble',
  alt_shot: 'Alternate shot',
  best_ball: 'Best ball',
}

export const TEAM_METHODS: Method[] = ['scramble', 'alt_shot', 'best_ball']

export function defaultSegments(teamSize: number): Segment[] {
  return [{ from: 1, to: 18, method: teamSize === 1 ? 'individual' : 'scramble', count: 1 }]
}

/** Same rules as the database. Returns null when valid. */
export function segmentsProblem(segs: Segment[], teamSize: number): string | null {
  if (!segs.length) return 'Choose a format for the round.'
  let next = 1
  for (const s of segs) {
    if (s.from !== next || s.to < s.from || s.to > 18) return 'Format segments must cover holes 1–18 in order.'
    if (teamSize === 1 && s.method !== 'individual') return 'Individual events use stroke play on every hole.'
    if (teamSize > 1 && !TEAM_METHODS.includes(s.method)) return 'Team events use scramble, alternate shot or best ball.'
    if (s.method === 'best_ball' && (s.count < 1 || s.count > teamSize))
      return `Best ball must count between 1 and ${teamSize} scores per hole.`
    next = s.to + 1
  }
  return next === 19 ? null : 'Format segments must cover holes 1–18.'
}

export function segmentFor(segs: Segment[], hole: number): Segment {
  const s = segs.find((x) => hole >= x.from && hole <= x.to)
  if (!s) throw new Error(`No format for hole ${hole}`)
  return s
}

export const isPlayerHole = (segs: Segment[], hole: number) => segmentFor(segs, hole).method === 'best_ball'

const holesText = (s: Segment) => (s.from === 1 && s.to === 18 ? '' : ` ${s.from}–${s.to}`)

function methodText(s: Segment, teamSize: number): string {
  if (s.method === 'best_ball') {
    if (s.count === 1) return 'Best ball'
    return `Best ${s.count} of ${teamSize}`
  }
  return METHOD_LABEL[s.method]
}

/** e.g. "Individual stroke play", "3-person best 2 of 3", "2-person: Scramble 1–6, Alternate shot 7–12, Best ball 13–18". */
export function describeFormat(segs: Segment[], teamSize: number): string {
  if (teamSize === 1) return 'Individual stroke play'
  const parts = segs.map((s) => `${methodText(s, teamSize)}${holesText(s)}`)
  if (segs.length === 1) return `${teamSize}-person ${parts[0]!.charAt(0).toLowerCase()}${parts[0]!.slice(1)}`
  return `${teamSize}-person: ${parts.join(', ')}`
}

/** Scores recorded for one entry on one hole of a round. */
export interface HoleScores {
  /** Team (or individual) score; scramble, alternate shot, individual holes. */
  entry?: number
  /** Player scores on best-ball holes. */
  players?: ReadonlyMap<string, number>
}

/**
 * The score that counts for the hole, or null if the hole isn't finished.
 * Best ball sums the lowest `count` player scores and needs at least `count` of them;
 * a missing player score is a pick-up, never zero.
 */
export function countingScore(seg: Segment, s: HoleScores | undefined): number | null {
  if (!s) return null
  if (seg.method !== 'best_ball') return s.entry ?? null
  const vals = [...(s.players?.values() ?? [])].sort((a, b) => a - b)
  if (vals.length < seg.count) return null
  return vals.slice(0, seg.count).reduce((a, b) => a + b, 0)
}

/** Par for the counting score: best 2 of 3 on a par 4 is "par 8". */
export const countingPar = (seg: Segment, par: number) => (seg.method === 'best_ball' ? par * seg.count : par)

export interface RawScore {
  entryId: string
  playerId: string | null
  hole: number
  strokes: number
}

/** Fold raw score rows into per-entry, per-hole counting scores for one round. */
export function countingCards(segs: Segment[], scores: Iterable<RawScore>): Map<string, Map<number, number>> {
  const byEntry = new Map<string, Map<number, { entry?: number; players: Map<string, number> }>>()
  for (const s of scores) {
    if (s.hole < 1 || s.hole > 18) continue
    const seg = segmentFor(segs, s.hole)
    const holes = byEntry.get(s.entryId) ?? new Map()
    byEntry.set(s.entryId, holes)
    const h = holes.get(s.hole) ?? { players: new Map<string, number>() }
    holes.set(s.hole, h)
    // Ignore rows that don't match the hole's method (e.g. left over from a format change).
    if (seg.method === 'best_ball') {
      if (s.playerId) h.players.set(s.playerId, s.strokes)
    } else if (!s.playerId) h.entry = s.strokes
  }
  const out = new Map<string, Map<number, number>>()
  for (const [entryId, holes] of byEntry) {
    const card = new Map<number, number>()
    for (const [hole, h] of holes) {
      const v = countingScore(segmentFor(segs, hole), h)
      if (v !== null) card.set(hole, v)
    }
    out.set(entryId, card)
  }
  return out
}
