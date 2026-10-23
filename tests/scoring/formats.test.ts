import { describe, expect, it } from 'vitest'
import { computeEventLeaderboard, flightsFromStandings } from '../../src/scoring/event'
import { countingCards, countingScore, describeFormat, segmentsProblem, type Segment } from '../../src/scoring/formats'

const s = (from: number, to: number, method: Segment['method'], count = 1): Segment => ({ from, to, method, count })

describe('formats', () => {
  it('best ball counts the lowest N and needs N scores', () => {
    const seg = s(1, 18, 'best_ball', 2)
    expect(countingScore(seg, { players: new Map([['a', 5], ['b', 3], ['c', 4]]) })).toBe(7)
    expect(countingScore(seg, { players: new Map([['a', 5]]) })).toBeNull()
    expect(countingScore(s(1, 18, 'scramble'), { entry: 3 })).toBe(3)
    expect(countingScore(s(1, 18, 'scramble'), {})).toBeNull()
  })

  it('ignores scores that do not fit the hole method', () => {
    const segs = [s(1, 6, 'scramble'), s(7, 12, 'alt_shot'), s(13, 18, 'best_ball')]
    const cards = countingCards(segs, [
      { entryId: 'e', playerId: null, hole: 1, strokes: 4 },
      { entryId: 'e', playerId: 'p', hole: 2, strokes: 9 }, // player score on a scramble hole
      { entryId: 'e', playerId: null, hole: 13, strokes: 9 }, // team score on a best-ball hole
      { entryId: 'e', playerId: 'p', hole: 14, strokes: 5 },
      { entryId: 'e', playerId: 'q', hole: 14, strokes: 4 },
    ])
    expect([...cards.get('e')!]).toEqual([[1, 4], [14, 4]])
  })

  it('validates like the database', () => {
    expect(segmentsProblem([s(1, 18, 'best_ball', 2)], 3)).toBeNull()
    expect(segmentsProblem([s(1, 9, 'scramble'), s(11, 18, 'scramble')], 2)).toMatch(/1–18/)
    expect(segmentsProblem([s(1, 18, 'scramble')], 1)).toMatch(/Individual/)
    expect(segmentsProblem([s(1, 18, 'best_ball', 3)], 2)).toMatch(/between 1 and 2/)
  })

  it('describes formats in plain words', () => {
    expect(describeFormat([s(1, 18, 'individual')], 1)).toBe('Individual stroke play')
    expect(describeFormat([s(1, 18, 'scramble')], 4)).toBe('4-person scramble')
    expect(describeFormat([s(1, 18, 'best_ball', 2)], 3)).toBe('3-person best 2 of 3')
    expect(describeFormat([s(1, 6, 'scramble'), s(7, 12, 'alt_shot'), s(13, 18, 'best_ball')], 2)).toBe(
      '2-person: Scramble 1–6, Alternate shot 7–12, Best ball 13–18',
    )
  })
})

describe('flights from standings', () => {
  it('keeps teams tied at a cut together in the higher flight', () => {
    const rows = [
      { entryId: 'a', position: 1 },
      { entryId: 'b', position: 2 },
      { entryId: 'c', position: 2 },
      { entryId: 'd', position: 4 },
      { entryId: 'e', position: null },
    ]
    expect(flightsFromStandings(rows, [{ flightId: 'A', size: 2 }, { flightId: 'B', size: 0 }])).toEqual([
      { entryId: 'a', flightId: 'A' },
      { entryId: 'b', flightId: 'A' },
      { entryId: 'c', flightId: 'A' },
      { entryId: 'd', flightId: 'B' },
    ])
  })
})

describe('event leaderboard', () => {
  const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4 }))
  const full = (v: number) => new Map(holes.map((h) => [h.number, v]))

  it('a player on a different tee is measured against that tee’s par', () => {
    const lb = computeEventLeaderboard({
      rounds: [{ id: 'r1', number: 1, holes, cards: new Map([['a', full(4)], ['b', full(4)]]), entryPars: new Map([['b', new Map(holes.map((h) => [h.number, 5]))]]) }],
      entries: [{ id: 'a', name: 'A', status: 'active', flightId: null }, { id: 'b', name: 'B', status: 'active', flightId: null }],
      flights: [],
      byFlight: false,
      tiebreak: 'share',
      final: false,
    })
    expect(lb.groups[0]!.rows.map((r) => [r.entryId, r.toPar])).toEqual([['b', -18], ['a', 0]])
  })

  it('puts entries without a flight in their own group', () => {
    const lb = computeEventLeaderboard({
      rounds: [{ id: 'r1', number: 1, holes, cards: new Map([['a', full(4)], ['b', full(3)]]) }],
      entries: [{ id: 'a', name: 'A', status: 'active', flightId: 'F' }, { id: 'b', name: 'B', status: 'active', flightId: null }],
      flights: [{ id: 'F', name: 'First' }],
      byFlight: true,
      tiebreak: 'share',
      final: false,
    })
    expect(lb.groups.map((g) => [g.name, g.rows.map((r) => r.positionLabel)])).toEqual([['First', ['1']], ['No flight', ['1']]])
  })

  it('shows thru for the round in play and F when every round is done', () => {
    const part = new Map([...full(4)].slice(0, 9))
    const lb = computeEventLeaderboard({
      rounds: [
        { id: 'r1', number: 1, holes, cards: new Map([['a', full(4)], ['b', full(4)]]) },
        { id: 'r2', number: 2, holes, cards: new Map([['a', part], ['b', full(4)]]) },
      ],
      entries: [{ id: 'a', name: 'A', status: 'active', flightId: null }, { id: 'b', name: 'B', status: 'active', flightId: null }],
      flights: [],
      byFlight: false,
      tiebreak: 'share',
      final: false,
    })
    const rows = lb.groups[0]!.rows
    expect(rows.map((r) => [r.entryId, r.thru, r.gross])).toEqual([['b', 'F', 144], ['a', '9', 108]])
  })
})
