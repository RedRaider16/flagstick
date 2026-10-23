// Golf Genius results as the answer key. Fixtures are real past events with the
// names replaced by ids (tests/fixtures/gg-*.json, made from the organizer's own
// Golf Genius leaderboards). Flagstick must reproduce every total and position.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { computeEventLeaderboard, flightsFromStandings, type EvRound } from '../../src/scoring/event'
import { countingCards, countingPar, segmentFor, segmentsProblem, type Segment } from '../../src/scoring/formats'
import type { EntryStatus } from '../../src/domain/types'

interface Fixture {
  title: string
  teamSize: number
  pars: number[]
  flights: string[]
  rounds: { segments: Segment[]; byFlight: boolean }[]
  entries: { id: string; flight?: string; status?: EntryStatus; sundayFlight?: string; sundayStatus?: EntryStatus }[]
  scores: [number, string, string | null, number, number][]
  expected: Record<string, unknown>
}

const load = (f: string): Fixture => JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', f), 'utf8'))

function round(fx: Fixture, i: number): EvRound {
  const segs = fx.rounds[i]!.segments
  return {
    id: `r${i + 1}`,
    number: i + 1,
    holes: fx.pars.map((par, h) => ({ number: h + 1, par: countingPar(segmentFor(segs, h + 1), par) })),
    cards: countingCards(
      segs,
      fx.scores.filter((s) => s[0] === i).map(([, entryId, playerId, hole, strokes]) => ({ entryId, playerId, hole, strokes })),
    ),
  }
}

describe.each(['gg-jimmy-roger-2024.json', 'gg-jimmy-roger-2025.json', 'gg-jimmy-roger-2026.json'])('%s (3-man, best 2 balls, 2 rounds, flights)', (file) => {
  const fx = load(file)
  const flights = fx.flights.map((name) => ({ id: name, name }))
  const lb = computeEventLeaderboard({
    rounds: [round(fx, 0), round(fx, 1)],
    entries: fx.entries.map((e) => ({ id: e.id, name: e.id, status: e.status ?? 'active', flightId: e.flight ?? null })),
    flights,
    byFlight: true,
    tiebreak: 'share',
    final: true,
  })
  const rows = lb.groups.flatMap((g) => g.rows)

  it('formats are valid', () => expect(segmentsProblem(fx.rounds[0]!.segments, 3)).toBeNull())

  it('reproduces every round score', () => {
    const expected = fx.expected.roundGross as Record<string, (number | null)[]>
    const got = Object.fromEntries(rows.map((r) => [r.entryId, r.rounds.map((c) => (c.complete ? c.gross : null))]))
    // DNF/NS rounds are incomplete here; Golf Genius shows them blank too.
    expect(got).toEqual(expected)
  })

  it('reproduces every position, ranked within each flight; DNF and NS unranked', () => {
    const expected = fx.expected.overall as Record<string, string>
    expect(Object.fromEntries(rows.map((r) => [r.entryId, r.positionLabel]))).toEqual(expected)
  })

  it('lists flights in order', () => expect(lb.groups.map((g) => g.name)).toEqual(fx.flights))
})

describe('2025 United Way (4-person scramble, each day its own competition, Sunday flights from Saturday)', () => {
  const fx = load('gg-united-way-2025.json')
  const sat = computeEventLeaderboard({
    rounds: [round(fx, 0)],
    entries: fx.entries.map((e) => ({ id: e.id, name: e.id, status: 'active', flightId: null })),
    flights: [],
    byFlight: false,
    tiebreak: 'share',
    final: true,
  })
  const satRows = sat.groups[0]!.rows

  it('reproduces Saturday positions', () => {
    expect(Object.fromEntries(satRows.map((r) => [r.entryId, r.positionLabel]))).toEqual(fx.expected.saturday)
  })

  it('cuts Sunday flights from Saturday standings: 10, 11, 10, 10, rest', () => {
    const cuts = fx.flights.map((f, i) => ({ flightId: f, size: [10, 11, 10, 10, 0][i]! }))
    const got = flightsFromStandings(satRows, cuts)
    expect(Object.fromEntries(got.map((a) => [a.entryId, a.flightId]))).toEqual(
      Object.fromEntries(fx.entries.map((e) => [e.id, e.sundayFlight])),
    )
  })

  it('reproduces Sunday positions within flights, with DNF and DQ', () => {
    const sun = computeEventLeaderboard({
      rounds: [round(fx, 1)],
      entries: fx.entries.map((e) => ({ id: e.id, name: e.id, status: e.sundayStatus ?? 'active', flightId: e.sundayFlight! })),
      flights: fx.flights.map((name) => ({ id: name, name })),
      byFlight: true,
      tiebreak: 'share',
      final: true,
    })
    const got = Object.fromEntries(sun.groups.flatMap((g) => g.rows).map((r) => [r.entryId, r.positionLabel]))
    expect(got).toEqual(fx.expected.sunday)
  })
})

describe('2024 CTMGA 666 (scramble / alternate shot / best ball, order changes on day two)', () => {
  const fx = load('gg-ctmga-666-2024.json')
  const lb = computeEventLeaderboard({
    rounds: [round(fx, 0), round(fx, 1)],
    entries: fx.entries.map((e) => ({ id: e.id, name: e.id, status: 'active', flightId: null })),
    flights: [],
    byFlight: false,
    tiebreak: 'share',
    final: false,
  })
  const rows = lb.groups[0]!.rows

  it('formats are valid', () => {
    expect(segmentsProblem(fx.rounds[0]!.segments, 2)).toBeNull()
    expect(segmentsProblem(fx.rounds[1]!.segments, 2)).toBeNull()
  })

  it('reproduces the two-day totals of every complete team', () => {
    const totals = rows.filter((r) => r.complete).map((r) => r.gross).sort((a, b) => a! - b!)
    expect(totals).toEqual(fx.expected.completeTotalsSorted)
  })

  it('a missing best-ball score is a pick-up, not zero: incomplete cards stay incomplete', () => {
    expect(rows.filter((r) => !r.complete).length).toBe(2)
  })
})
