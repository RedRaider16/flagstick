// UI-facing helpers that turn an EventBundle into what screens need.
import { computeEventLeaderboard, type EventLeaderboard, type EvRound } from '../scoring/event'
import { countingCards, countingPar, describeFormat, segmentFor, type Segment } from '../scoring/formats'
import { entryName, type Entry, type EventBundle, type Group, type Hole, type Player, type Round, type Score, type Tee } from './types'

export const isTeamEvent = (b: EventBundle) => b.event.teamSize > 1

export function roundById(b: EventBundle, roundId: string | null | undefined): Round {
  return b.rounds.find((r) => r.id === roundId) ?? b.rounds[0]!
}

export const teeOf = (b: EventBundle, teeId: string | null | undefined): Tee | null => b.tees.find((t) => t.id === teeId) ?? null

export function teeHoles(b: EventBundle, teeId: string | null | undefined): Hole[] {
  if (!teeId) return []
  return b.holes.filter((h) => h.teeId === teeId).sort((x, y) => x.number - y.number)
}

export const roundHoles = (b: EventBundle, round: Round) => teeHoles(b, round.teeId)
export const roundGroups = (b: EventBundle, roundId: string) => b.groups.filter((g) => g.roundId === roundId)
export const roundScores = (b: EventBundle, roundId: string) => b.scores.filter((s) => s.roundId === roundId)

export function groupOfEntry(groups: Group[], entryId: string, roundId?: string): Group | undefined {
  return groups.find((g) => (!roundId || g.roundId === roundId) && g.entryIds.includes(entryId))
}

export function nameOf(b: EventBundle, entry: Entry): string {
  return entryName(entry, b.players, b.teams)
}

/** Players behind an entry: the player, or the team members. */
export function entryPlayers(b: EventBundle, entry: Entry): Player[] {
  if (entry.kind === 'player') return b.players.filter((p) => p.id === entry.playerId)
  const t = b.teams.find((x) => x.id === entry.teamId)
  return (t?.playerIds ?? []).map((id) => b.players.find((p) => p.id === id)).filter((p): p is Player => !!p)
}

export const formatOf = (b: EventBundle, round: Round) => describeFormat(round.segments, b.event.teamSize)

/** One description if every round plays the same format, else "Round 1: …; Round 2: …". */
export function eventFormatText(b: EventBundle): string {
  const texts = b.rounds.map((r) => formatOf(b, r))
  if (new Set(texts).size <= 1) return texts[0] ?? ''
  return b.rounds.map((r, i) => `Round ${r.roundNumber}: ${texts[i]}`).join('; ')
}

export const hasPlayerHoles = (round: Round) => round.segments.some((s) => s.method === 'best_ball')

/** The stored score in a slot (team score when playerId is null). */
export function slotScore(b: EventBundle, roundId: string, entryId: string, playerId: string | null, hole: number): Score | undefined {
  return b.scores.find((s) => s.roundId === roundId && s.entryId === entryId && s.hole === hole && (s.playerId ?? null) === playerId)
}

function evRound(b: EventBundle, round: Round): EvRound {
  const holes = roundHoles(b, round)
  const segs: Segment[] = round.segments
  const parFor = (hs: Hole[]) => hs.map((h) => ({ number: h.number, par: countingPar(segmentFor(segs, h.number), h.par) }))
  const entryPars = new Map<string, Map<number, number>>()
  if (!isTeamEvent(b))
    for (const e of b.entries) {
      const p = b.players.find((x) => x.id === e.playerId)
      if (p?.teeId && p.teeId !== round.teeId) {
        const own = teeHoles(b, p.teeId)
        if (own.length === 18) entryPars.set(e.id, new Map(own.map((h) => [h.number, h.par])))
      }
    }
  const groups = roundGroups(b, round.id)
  return {
    id: round.id,
    number: round.roundNumber,
    holes: parFor(holes),
    cards: countingCards(segs, roundScores(b, round.id)),
    startingHole: new Map(b.entries.map((e) => [e.id, groupOfEntry(groups, e.id)?.startingHole ?? 1])),
    entryPars,
  }
}

export type Scope = 'overall' | string

/** Leaderboard for the whole event ('overall') or one round (its id). */
export function buildEventLeaderboard(b: EventBundle, scope: Scope): EventLeaderboard {
  const rounds = scope === 'overall' ? b.rounds : b.rounds.filter((r) => r.id === scope)
  const byFlight = scope === 'overall' ? b.rounds.some((r) => r.useFlights) : rounds.some((r) => r.useFlights)
  return computeEventLeaderboard({
    rounds: rounds.filter((r) => r.teeId).map((r) => evRound(b, r)),
    entries: b.entries.map((e) => ({ id: e.id, name: nameOf(b, e), status: e.status, flightId: e.flightId })),
    flights: b.flights.map((f) => ({ id: f.id, name: f.name })),
    byFlight,
    tiebreak: b.event.tiebreakPolicy,
    final: rounds.length > 0 && rounds.every((r) => r.status === 'finalized'),
  })
}

/** Leaderboard views to offer: overall plus each round, or just rounds when each day stands alone. */
export function leaderboardScopes(b: EventBundle): { scope: Scope; label: string }[] {
  if (b.rounds.length === 1) return [{ scope: b.rounds[0]!.id, label: 'Leaderboard' }]
  const rounds = b.rounds.map((r) => ({ scope: r.id, label: `Round ${r.roundNumber}` }))
  return b.event.cumulative ? [{ scope: 'overall', label: 'Overall' }, ...rounds] : rounds
}

/** The round being played now: the first not yet final (or the last). */
export function currentRound(b: EventBundle): Round {
  return b.rounds.find((r) => r.status !== 'finalized') ?? b.rounds[b.rounds.length - 1]!
}

/** Count of holes finished for an entry in a round (best ball needs `count` player scores). */
export function holesDone(b: EventBundle, round: Round, entryId: string): number {
  const cards = countingCards(round.segments, roundScores(b, round.id).filter((s) => s.entryId === entryId))
  return cards.get(entryId)?.size ?? 0
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

/** "Sat, Apr 18, 2026" or "Sat, Apr 18 – Sun, Apr 19, 2026". */
export function eventDates(b: EventBundle): string {
  const first = b.rounds[0]?.date ?? b.event.date
  const last = b.rounds[b.rounds.length - 1]?.date ?? first
  return first === last ? formatDate(first) : `${formatShortDate(first)} – ${formatDate(last)}`
}

export function formatTeeTime(t: string | null): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  if (h === undefined || m === undefined || Number.isNaN(h)) return t
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ampm}`
}

export function formatStamp(iso: string, timezone?: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timezone })
  } catch {
    return new Date(iso).toLocaleString()
  }
}

/** Add days to a YYYY-MM-DD date. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Same weekday, one year on (the usual date for an annual event). */
export function nextYearSameWeekday(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  const target = new Date(d)
  target.setUTCFullYear(d.getUTCFullYear() + 1)
  const diff = (d.getUTCDay() - target.getUTCDay() + 7) % 7
  target.setUTCDate(target.getUTCDate() + (diff > 3 ? diff - 7 : diff))
  return target.toISOString().slice(0, 10)
}
