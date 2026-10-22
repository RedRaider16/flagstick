import { describe, expect, it } from 'vitest'
import {
  computeLeaderboard,
  finalizationBlockers,
  findGaps,
  formatThru,
  formatToPar,
  rotation,
  type LbEntry,
  type LbHole,
} from '../../src/scoring/leaderboard'

// Par 72: 4,4,3,4,5,3,5,4,4 | 4,3,4,4,5,3,4,4,5
const PARS = [4, 4, 3, 4, 5, 3, 5, 4, 4, 4, 3, 4, 4, 5, 3, 4, 4, 5]
const HOLES: LbHole[] = PARS.map((par, i) => ({ number: i + 1, par }))

const entry = (id: string, extra: Partial<LbEntry> = {}): LbEntry => ({
  id,
  name: id,
  status: 'active',
  startingHole: 1,
  ...extra,
})

/** Card from a delta-to-par array (length ≤ 18); undefined = missing. */
function card(deltas: (number | undefined)[]): Map<number, number> {
  const m = new Map<number, number>()
  deltas.forEach((d, i) => {
    if (d !== undefined) m.set(i + 1, PARS[i]! + d)
  })
  return m
}
const even = () => Array<number>(18).fill(0)

function lb(entries: LbEntry[], scores: Record<string, Map<number, number>>, tiebreak: 'share' | 'card_back' = 'share') {
  return computeLeaderboard({
    holes: HOLES,
    entries,
    scores: new Map(Object.entries(scores)),
    tiebreak,
    final: false,
  })
}

describe('gross totals and to-par', () => {
  it('computes gross and to-par for a complete round', () => {
    const d = even()
    d[0] = -1 // birdie 1
    d[17] = 2 // double 18
    const res = lb([entry('A')], { A: card(d) })
    const row = res.rows[0]!
    expect(row.gross).toBe(73)
    expect(row.toPar).toBe(1)
    expect(row.complete).toBe(true)
    expect(row.holesPlayed).toBe(18)
    expect(formatThru(row)).toBe('F')
  })

  it('missing holes stay missing — never treated as zero or par', () => {
    // 3 holes played, all bogeys
    const res = lb([entry('A')], { A: card([1, 1, 1]) })
    const row = res.rows[0]!
    expect(row.holesPlayed).toBe(3)
    expect(row.gross).toBe(5 + 5 + 4)
    expect(row.toPar).toBe(3) // only par of played holes
    expect(row.complete).toBe(false)
    expect(formatThru(row)).toBe('3')
  })

  it('entries with no scores are unranked and listed after ranked entries', () => {
    const res = lb([entry('Zed'), entry('A'), entry('B')], { A: card([0]) })
    expect(res.rows.map((r) => r.entryId)).toEqual(['A', 'B', 'Zed'])
    const b = res.rows[1]!
    expect(b.position).toBeNull()
    expect(b.gross).toBeNull()
    expect(b.toPar).toBeNull()
    expect(b.positionLabel).toBe('—')
  })

  it('ignores scores for holes that are not on the course', () => {
    const m = card([0])
    m.set(19, 3)
    const res = lb([entry('A')], { A: m })
    expect(res.rows[0]!.holesPlayed).toBe(1)
  })

  it('formats to-par', () => {
    expect(formatToPar(0)).toBe('E')
    expect(formatToPar(3)).toBe('+3')
    expect(formatToPar(-2)).toBe('-2')
    expect(formatToPar(null)).toBe('—')
  })
})

describe('positions and ties', () => {
  it('uses standard competition ranking (1, T2, T2, 4)', () => {
    const res = lb([entry('A'), entry('B'), entry('C'), entry('D')], {
      A: card([-2]),
      B: card([0]),
      C: card([0]),
      D: card([1]),
    })
    expect(res.rows.map((r) => [r.entryId, r.positionLabel])).toEqual([
      ['A', '1'],
      ['B', 'T2'],
      ['C', 'T2'],
      ['D', '4'],
    ])
  })

  it('players at the same to-par are tied even with different holes played', () => {
    const res = lb([entry('A'), entry('B')], { A: card([0, 0, 0, 0]), B: card([0]) })
    expect(res.rows.every((r) => r.positionLabel === 'T1')).toBe(true)
    // cosmetic order: more holes played first
    expect(res.rows[0]!.entryId).toBe('A')
  })

  it('share policy leaves complete ties tied', () => {
    const a = even()
    a[17] = -1
    a[0] = 1
    const b = even()
    const res = lb([entry('A'), entry('B')], { A: card(a), B: card(b) }, 'share')
    expect(res.rows.map((r) => r.positionLabel)).toEqual(['T1', 'T1'])
    expect(res.unresolvedTies).toEqual([])
  })
})

describe('card-back tie-break', () => {
  it('separates on holes 10–18 first', () => {
    const a = even()
    a[0] = 1
    a[17] = -1 // A: better back nine
    const b = even()
    const res = lb([entry('B'), entry('A')], { A: card(a), B: card(b) }, 'card_back')
    expect(res.rows.map((r) => [r.entryId, r.positionLabel])).toEqual([
      ['A', '1'],
      ['B', '2'],
    ])
    expect(res.rows[0]!.tiebreakNote).toBe('Separated on holes 10–18')
  })

  it('falls through to 13–18, 16–18, 18, then the front-nine steps', () => {
    // Same back-nine total, A better on 13–18
    const a = even()
    a[9] = 1 // hole 10 +1
    a[12] = -1 // hole 13 -1
    const b = even()
    let res = lb([entry('A'), entry('B')], { A: card(a), B: card(b) }, 'card_back')
    expect(res.rows[0]!.entryId).toBe('A')
    expect(res.rows[0]!.tiebreakNote).toBe('Separated on holes 13–18')

    // Identical back nine; front nine differs only on hole 9 vs hole 3
    const c = even()
    c[2] = 1 // hole 3 +1
    c[8] = -1 // hole 9 -1
    const d = even()
    res = lb([entry('C'), entry('D')], { C: card(c), D: card(d) }, 'card_back')
    // holes 4–9: C -1 vs D 0 → C wins at step "holes 4–9"
    expect(res.rows[0]!.entryId).toBe('C')
    expect(res.rows[0]!.tiebreakNote).toBe('Separated on holes 4–9')
  })

  it('leaves identical cards tied and reports the unresolved tie', () => {
    const res = lb([entry('A'), entry('B')], { A: card(even()), B: card(even()) }, 'card_back')
    expect(res.rows.map((r) => r.positionLabel)).toEqual(['T1', 'T1'])
    expect(res.unresolvedTies).toEqual([['A', 'B']])
  })

  it('does not apply card-back if any tied entry is incomplete', () => {
    const a = even()
    a[0] = 1
    a[17] = -1
    const res = lb([entry('A'), entry('B')], { A: card(a), B: card([0, 0]) }, 'card_back')
    expect(res.rows.map((r) => r.positionLabel)).toEqual(['T1', 'T1'])
    expect(res.rows.every((r) => r.tiebreakNote === null)).toBe(true)
  })

  it('splits a three-way tie and keeps positions consistent', () => {
    const a = even()
    a[0] = 1
    a[17] = -1 // back -1
    const b = even() // back 0
    const c = even() // back 0, identical to b
    const res = lb([entry('A'), entry('B'), entry('C'), entry('D')], {
      A: card(a),
      B: card(b),
      C: card(c),
      D: card(Array(18).fill(1)),
    }, 'card_back')
    expect(res.rows.map((r) => [r.entryId, r.positionLabel])).toEqual([
      ['A', '1'],
      ['B', 'T2'],
      ['C', 'T2'],
      ['D', '4'],
    ])
  })
})

describe('withdrawals and disqualifications', () => {
  it('lists WD/DQ last, unranked, and keeps their scores', () => {
    const res = lb([entry('A', { status: 'wd' }), entry('B'), entry('C', { status: 'dq' })], {
      A: card([-3, -3]),
      B: card([2]),
      C: card(even()),
    })
    expect(res.rows.map((r) => [r.entryId, r.positionLabel])).toEqual([
      ['B', '1'],
      ['C', 'DQ'],
      ['A', 'WD'],
    ])
    const a = res.rows.find((r) => r.entryId === 'A')!
    expect(a.position).toBeNull()
    expect(a.holesPlayed).toBe(2)
  })

  it('WD/DQ entries do not block finalization; incomplete active entries do', () => {
    const res = lb([entry('A', { status: 'wd' }), entry('B'), entry('C')], {
      A: card([0]),
      B: card(even()),
      C: card([0, 0, 0]),
    })
    const blockers = finalizationBlockers(res)
    expect(blockers).toHaveLength(1)
    expect(blockers[0]).toContain('C')
    expect(blockers[0]).toContain('15 hole(s) missing')
  })
})

describe('starting holes, rotation and gaps', () => {
  it('builds the rotation for a shotgun start', () => {
    expect(rotation(7).slice(0, 13)).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 1])
    expect(rotation(1)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1))
  })

  it('flags holes skipped along the rotation', () => {
    expect(findGaps(7, new Set([7, 8, 10]))).toEqual([9])
    expect(findGaps(16, new Set([16, 17, 18, 1, 3]))).toEqual([2])
    expect(findGaps(1, new Set())).toEqual([])
    expect(findGaps(10, new Set([10, 11]))).toEqual([])
  })

  it('marks thru with * for non-hole-1 starts', () => {
    const m = new Map([
      [10, 4],
      [11, 3],
    ])
    const res = lb([entry('A', { startingHole: 10 })], { A: m })
    expect(formatThru(res.rows[0]!)).toBe('2*')
    expect(res.rows[0]!.gaps).toEqual([])
  })
})

describe('score changes after submission', () => {
  it('recomputing with a corrected score updates totals and positions', () => {
    const before = lb([entry('A'), entry('B')], { A: card([0, 0]), B: card([0, 1]) })
    expect(before.rows[0]!.entryId).toBe('A')
    const after = lb([entry('A'), entry('B')], { A: card([0, 2]), B: card([0, 1]) })
    expect(after.rows.map((r) => r.entryId)).toEqual(['B', 'A'])
    expect(after.rows[1]!.toPar).toBe(2)
  })
})
