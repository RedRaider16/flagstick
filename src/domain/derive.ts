// UI-facing helpers that turn an EventBundle into what screens need.
import { computeEventLeaderboard, type EventLeaderboard, type EvRound } from '../scoring/event'
import { countingCards, countingPar, describeFormat, segmentFor, type Segment } from '../scoring/formats'
import { courseHandicap, entryHandicaps, HANDICAP_PROBLEM_TEXT, netCard, type HandicapProblem } from '../scoring/handicap'
import { computeSkins, splitPayouts, type SkinsResult } from '../scoring/sidegames'
import type { PayoutTable, ScoringBasis, SideGame } from './types'
import { entryName, type Entry, type EntryStatus, type EventBundle, type Group, type Hole, type Player, type Round, type Score, type Tee } from './types'

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

export type Basis = 'gross' | 'net'

/** Which leaderboards an event shows. */
export const basesOf = (s: ScoringBasis): Basis[] => (s === 'both' ? ['gross', 'net'] : [s])

/** Course Handicap for a player on a tee, or the reason it can't be worked out. */
export function playerCourseHandicap(b: EventBundle, playerId: string, teeId: string | null): number | HandicapProblem {
  const tee = teeOf(b, teeId)
  if (!tee) return 'no_rating'
  const hs = teeHoles(b, tee.id)
  const hi = b.handicaps.find((h) => h.playerId === playerId)?.handicapIndex
  return courseHandicap(hi, { rating: tee.rating, slope: tee.slope, par: hs.reduce((a, h) => a + h.par, 0) }, b.event.maxHandicapIndex)
}

/** Net cards for a round: entryId → hole → net counting score, plus entries that can't be scored net. */
export function netCards(b: EventBundle, round: Round): { cards: Map<string, Map<number, number>>; excluded: Map<string, string> } {
  const cards = new Map<string, Map<number, number>>()
  const excluded = new Map<string, string>()
  const holes = roundHoles(b, round)
  const si = new Map(holes.map((h) => [h.number, h.strokeIndex]))
  const scores = roundScores(b, round.id)
  for (const e of b.entries) {
    const players = entryPlayers(b, e)
    const hcp = entryHandicaps(
      round.segments,
      players.map((p) => ({ playerId: p.id, courseHandicap: playerCourseHandicap(b, p.id, !isTeamEvent(b) && p.teeId ? p.teeId : round.teeId) })),
      b.event.teamSize,
      b.event.netAllowances,
    )
    if (typeof hcp === 'string') {
      excluded.set(e.id, HANDICAP_PROBLEM_TEXT[hcp])
      continue
    }
    // Individual events on another tee: that tee's stroke index.
    const own = !isTeamEvent(b) && players[0]?.teeId && players[0].teeId !== round.teeId ? teeHoles(b, players[0].teeId) : null
    const siFor = own && own.length === 18 ? new Map(own.map((h) => [h.number, h.strokeIndex])) : si
    cards.set(e.id, netCard(round.segments, scores.filter((s) => s.entryId === e.id), hcp, siFor))
  }
  return { cards, excluded }
}

function evRound(b: EventBundle, round: Round, basis: Basis = 'gross', excluded?: Map<string, string>): EvRound {
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
    cards: basis === 'net' ? (() => {
      const n = netCards(b, round)
      n.excluded.forEach((v, k) => excluded?.set(k, v))
      return n.cards
    })() : countingCards(segs, roundScores(b, round.id)),
    startingHole: new Map(b.entries.map((e) => [e.id, groupOfEntry(groups, e.id)?.startingHole ?? 1])),
    entryPars,
  }
}

export type Scope = 'overall' | string

/** Leaderboard for the whole event ('overall') or one round (its id), gross or net. */
/**
 * An entry's status in one round: its whole-event status (WD, DQ …) if it has
 * one, otherwise a DNF / NS marked for that round only, otherwise playing.
 */
export function entryStatusIn(b: EventBundle, entryId: string, roundId: string): EntryStatus {
  const e = b.entries.find((x) => x.id === entryId)
  if (!e) return 'active'
  if (e.status !== 'active') return e.status
  return (b.roundStatuses ?? []).find((x) => x.roundId === roundId && x.entryId === entryId)?.status ?? 'active'
}

/** The first round (in order) an entry is marked out of, if any. */
function roundOut(b: EventBundle, entryId: string, rounds: Round[]) {
  for (const r of rounds) {
    const x = (b.roundStatuses ?? []).find((s) => s.roundId === r.id && s.entryId === entryId)
    if (x) return { round: r, status: x.status }
  }
  return null
}

export function buildEventLeaderboard(b: EventBundle, scope: Scope, basis: Basis = 'gross'): EventLeaderboard {
  const rounds = scope === 'overall' ? b.rounds : b.rounds.filter((r) => r.id === scope)
  const byFlight = scope === 'overall' ? b.rounds.some((r) => r.useFlights) : rounds.some((r) => r.useFlights)
  const excluded = new Map<string, string>()
  const evRounds = rounds.filter((r) => r.teeId).map((r) => evRound(b, r, basis, excluded))
  // Out of one round: unranked on that round's board and overall, still ranked on the others.
  const statusOf = (e: Entry): { status: EntryStatus; note?: string } => {
    if (e.status !== 'active') return { status: e.status }
    const out = roundOut(b, e.id, rounds)
    if (!out) return { status: 'active' }
    return { status: out.status, note: scope === 'overall' && b.rounds.length > 1 ? `${out.status === 'ns' ? 'no-show' : 'did not finish'} in round ${out.round.roundNumber}` : undefined }
  }
  const lb = computeEventLeaderboard({
    rounds: evRounds,
    entries: b.entries.map((e) => {
      const st = statusOf(e)
      return { id: e.id, name: nameOf(b, e), status: st.status, flightId: e.flightId, excluded: st.note ?? excluded.get(e.id) }
    }),
    flights: b.flights.map((f) => ({ id: f.id, name: f.name })),
    byFlight,
    tiebreak: b.event.tiebreakPolicy,
    final: rounds.length > 0 && rounds.every((r) => r.status === 'finalized'),
  })
  return withTeeTimes(b, lb, evRounds.map((r) => r.id))
}

/**
 * Thru for someone who hasn't started the round in play: their tee time (like
 * Golf Genius), instead of the last round's "F" or a dash.
 */
function withTeeTimes(b: EventBundle, lb: EventLeaderboard, roundIds: string[]): EventLeaderboard {
  if (b.rounds.length === 0) return lb
  const live = currentRound(b)
  const i = roundIds.indexOf(live.id)
  if (i < 0 || live.status === 'finalized') return lb
  const groups = roundGroups(b, live.id)
  for (const g of lb.groups)
    for (const row of g.rows) {
      if (row.status !== 'active' || (row.rounds[i]?.holesPlayed ?? 0) > 0) continue
      const grp = groups.find((x) => x.entryIds.includes(row.entryId))
      row.thru = live.startType === 'tee_times' && grp?.teeTime ? formatTeeTime(grp.teeTime).replace(' ', '\u00a0') : '—'
    }
  return lb
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

/** The payout table for a leaderboard group, if any. */
export function payoutTableFor(b: EventBundle, basis: Basis, scope: Scope, flightId: string | null): PayoutTable | undefined {
  const roundId = scope === 'overall' || b.rounds.length === 1 ? null : scope
  return b.payouts.find((t) => t.basis === basis && t.roundId === roundId && t.flightId === flightId)
}

/** Place money for a leaderboard: entryId → cents (empty when no payouts are set). */
export function leaderboardPayouts(b: EventBundle, lb: EventLeaderboard, basis: Basis, scope: Scope): Map<string, number> {
  const out = new Map<string, number>()
  for (const g of lb.groups) {
    const t = payoutTableFor(b, basis, scope, g.flightId)
    if (!t) continue
    splitPayouts(g.rows, t.amountsCents).forEach((v, k) => out.set(k, v))
  }
  return out
}

/** Skins for a side game, from the round's gross or net counting scores. */
export function skinsFor(b: EventBundle, game: SideGame): SkinsResult & { excluded: Map<string, string> } {
  const round = b.rounds.find((r) => r.id === game.roundId)
  const ids = game.entryIds.length ? game.entryIds : b.entries.filter((e) => e.status === 'active').map((e) => e.id)
  const entries = b.entries.filter((e) => ids.includes(e.id) && e.status === 'active')
  if (!round) return { ...computeSkins([], { carryover: game.carryover, purseCents: game.purseCents }), excluded: new Map() }
  let cards: Map<string, Map<number, number>>
  let excluded = new Map<string, string>()
  if (game.basis === 'net') {
    const n = netCards(b, round)
    cards = n.cards
    excluded = n.excluded
  } else cards = countingCards(round.segments, roundScores(b, round.id))
  const playing = entries.filter((e) => !excluded.has(e.id))
  const res = computeSkins(playing.map((e) => ({ id: e.id, name: nameOf(b, e), card: cards.get(e.id) ?? new Map() })), { carryover: game.carryover, purseCents: game.purseCents })
  return { ...res, excluded }
}
