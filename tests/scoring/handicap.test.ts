import { describe, expect, it } from 'vitest'
import type { Segment } from '../../src/scoring/formats'
import { altShotHandicap, courseHandicap, DEFAULT_ALLOWANCES, entryHandicaps, netCard, playingHandicap, scrambleHandicap, strokesOnHole } from '../../src/scoring/handicap'
import { computeSkins, splitPayouts } from '../../src/scoring/sidegames'

const tee = { rating: 71.5, slope: 132, par: 72 }

describe('course and playing handicap', () => {
  it('uses Index × Slope / 113 + (Rating − Par), rounded', () => {
    // 10.4 × 132 / 113 = 12.149; + (71.5 − 72) = 11.649 → 12
    expect(courseHandicap(10.4, tee)).toBe(12)
    // Plus handicap +1.2 on a neutral tee → −1
    expect(courseHandicap(-1.2, { rating: 72, slope: 113, par: 72 })).toBe(-1)
  })
  it('never treats a missing rating or Index as zero', () => {
    expect(courseHandicap(null, tee)).toBe('no_index')
    expect(courseHandicap(10, { rating: null, slope: 120, par: 72 })).toBe('no_rating')
  })
  it('caps the Index when a maximum is set', () => {
    expect(courseHandicap(50, { rating: 72, slope: 113, par: 72 }, 42)).toBe(42)
  })
  it('applies the allowance with .5 rounding up', () => {
    expect(playingHandicap(12, 95)).toBe(11) // 11.4
    expect(playingHandicap(15, 85)).toBe(13) // 12.75
    expect(playingHandicap(10, 85)).toBe(9) // 8.5 → 9
  })
})

describe('strokes by stroke index', () => {
  it('gives one stroke on the hardest holes, two when over 18', () => {
    expect(strokesOnHole(5, 5)).toBe(1)
    expect(strokesOnHole(5, 6)).toBe(0)
    expect(strokesOnHole(20, 1)).toBe(2)
    expect(strokesOnHole(20, 2)).toBe(2)
    expect(strokesOnHole(20, 3)).toBe(1)
  })
  it('a plus handicap gives strokes back from SI 18', () => {
    expect(strokesOnHole(-2, 18)).toBe(-1)
    expect(strokesOnHole(-2, 17)).toBe(-1)
    expect(strokesOnHole(-2, 16)).toBe(0)
  })
  it('totals 18 holes to the playing handicap', () => {
    for (const ph of [-3, 0, 7, 18, 25, 40]) {
      const total = Array.from({ length: 18 }, (_, i) => strokesOnHole(ph, i + 1)).reduce((a, b) => a + b, 0)
      expect(total).toBe(ph)
    }
  })
})

describe('team handicaps', () => {
  it('2-person scramble 35% low + 15% high', () => {
    expect(scrambleHandicap([20, 10], DEFAULT_ALLOWANCES.scramble[2]!)).toBe(7) // 3.5 + 3.0 = 6.5 → 7
  })
  it('4-person scramble 25/20/15/10', () => {
    expect(scrambleHandicap([20, 5, 15, 10], DEFAULT_ALLOWANCES.scramble[4]!)).toBe(8) // 1.25+2+2.25+2 = 7.5 → 8
  })
  it('alternate shot 50% of combined', () => {
    expect(altShotHandicap([9, 14], 50)).toBe(12) // 11.5 → 12
  })
})

describe('net counting scores', () => {
  const si = new Map(Array.from({ length: 18 }, (_, i) => [i + 1, i + 1]))
  it('best 2 of 3 uses each player net, then the lowest two', () => {
    const segs: Segment[] = [{ from: 1, to: 18, method: 'best_ball', count: 2 }]
    const hcp = entryHandicaps(segs, [
      { playerId: 'a', courseHandicap: 0 },
      { playerId: 'b', courseHandicap: 20 }, // 85% → 17: a stroke on SI 1–17
      { playerId: 'c', courseHandicap: 2 }, // 85% → 2: SI 1–2
    ], 3, DEFAULT_ALLOWANCES)
    if (typeof hcp === 'string') throw new Error(hcp)
    const card = netCard(segs, [
      { playerId: 'a', hole: 1, strokes: 4 },
      { playerId: 'b', hole: 1, strokes: 5 },
      { playerId: 'c', hole: 1, strokes: 5 },
      { playerId: 'a', hole: 18, strokes: 4 },
      { playerId: 'b', hole: 18, strokes: 5 },
    ], hcp, si)
    expect(card.get(1)).toBe(4 + 4) // nets 4, 4, 4 → best two = 8
    expect(card.get(18)).toBe(4 + 5) // SI 18: no strokes for anyone
  })
  it('needs every player on a team to have what net scoring requires', () => {
    const segs: Segment[] = [{ from: 1, to: 18, method: 'scramble', count: 1 }]
    expect(entryHandicaps(segs, [{ playerId: 'a', courseHandicap: 5 }, { playerId: 'b', courseHandicap: 'no_index' }], 2, DEFAULT_ALLOWANCES)).toBe('no_index')
  })
  it('a scramble subtracts the team handicap by stroke index', () => {
    const segs: Segment[] = [{ from: 1, to: 18, method: 'scramble', count: 1 }]
    const hcp = entryHandicaps(segs, [{ playerId: 'a', courseHandicap: 10 }, { playerId: 'b', courseHandicap: 20 }], 2, DEFAULT_ALLOWANCES)
    if (typeof hcp === 'string') throw new Error(hcp)
    expect(hcp.team.scramble).toBe(7)
    const card = netCard(segs, [{ playerId: null, hole: 7, strokes: 4 }, { playerId: null, hole: 8, strokes: 4 }], hcp, si)
    expect(card.get(7)).toBe(3)
    expect(card.get(8)).toBe(4)
  })
})

describe('skins', () => {
  const card = (xs: number[]) => new Map(xs.map((v, i) => [i + 1, v]))
  const base = Array(18).fill(4)
  it('awards a skin only to an outright low score, carrying ties over', () => {
    const a = [...base]; a[0] = 3 // hole 1 outright
    const b = [...base]; b[1] = 3
    const c = [...base]; c[1] = 3; c[2] = 3 // hole 2 tied (b & c), hole 3 c wins with carry
    const r = computeSkins([{ id: 'a', name: 'A', card: card(a) }, { id: 'b', name: 'B', card: card(b) }, { id: 'c', name: 'C', card: card(c) }], { carryover: true, purseCents: 30000 })
    expect(r.holes[0]).toMatchObject({ winnerId: 'a', value: 1 })
    expect(r.holes[1]).toMatchObject({ state: 'tied', value: 1 })
    expect(r.holes[2]).toMatchObject({ winnerId: 'c', value: 2 })
    expect(r.won.get('a')).toBe(1)
    expect(r.won.get('c')).toBe(2)
    expect(r.perSkinCents).toBe(10000)
    expect(r.payouts.get('c')).toBe(20000)
  })
  it('without carryover a tie simply has no winner', () => {
    const b = [...base]; b[1] = 3
    const c = [...base]; c[1] = 3; c[2] = 3
    const r = computeSkins([{ id: 'b', name: 'B', card: card(b) }, { id: 'c', name: 'C', card: card(c) }], { carryover: false, purseCents: 0 })
    expect(r.holes[2]).toMatchObject({ winnerId: 'c', value: 1 })
  })
  it("doesn't decide a hole until every entry has a score", () => {
    const r = computeSkins([{ id: 'a', name: 'A', card: new Map([[1, 3]]) }, { id: 'b', name: 'B', card: new Map() }], { carryover: true, purseCents: 0 })
    expect(r.holes[0]!.state).toBe('open')
  })
})

describe('payouts', () => {
  it('tied places share the places they cover', () => {
    const rows = [{ entryId: 'a', position: 1 }, { entryId: 'b', position: 2 }, { entryId: 'c', position: 2 }, { entryId: 'd', position: 4 }, { entryId: 'e', position: null }]
    const p = splitPayouts(rows, [10000, 6000, 4000, 2000])
    expect(p.get('a')).toBe(10000)
    expect(p.get('b')).toBe(5000)
    expect(p.get('c')).toBe(5000)
    expect(p.get('d')).toBe(2000)
    expect(p.has('e')).toBe(false)
  })
  it('leftover cents go to the first in order', () => {
    const p = splitPayouts([{ entryId: 'a', position: 1 }, { entryId: 'b', position: 1 }, { entryId: 'c', position: 1 }], [10000])
    expect([p.get('a'), p.get('b'), p.get('c')]).toEqual([3334, 3333, 3333])
  })
})
