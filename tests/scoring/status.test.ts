import { describe, expect, it } from 'vitest'
import { DemoRepo } from '../../src/data/demoRepo'
import { courseStatus, groupStatus } from '../../src/domain/courseStatus'
import { buildEventLeaderboard } from '../../src/domain/derive'
import type { EventBundle, Score } from '../../src/domain/types'

const load = () => new DemoRepo().loadBundle('ev-classic')
const score = (entryId: string, hole: number, strokes = 4): Score => ({ id: `${entryId}-${hole}`, roundId: 'rd-classic', entryId, playerId: null, hole, strokes, version: 1, updatedAt: `2026-10-25T14:${String(hole).padStart(2, '0')}:00Z`, updatedBy: null })
/** Replace group 1's scores with the given holes for each of its entries. */
function withGroup1(b: EventBundle, holes: (entryIdx: number) => number[]): EventBundle {
  const g = b.groups.find((x) => x.id === 'gr-c1')!
  const others = b.scores.filter((s) => !g.entryIds.includes(s.entryId))
  return { ...b, scores: [...others, ...g.entryIds.flatMap((id, i) => holes(i).map((h) => score(id, h)))] }
}
const range = (a: number, z: number) => Array.from({ length: z - a + 1 }, (_, i) => a + i)

describe('course status board', () => {
  it('not started, on the course, finished', async () => {
    const b = await load()
    const round = b.rounds.find((r) => r.id === 'rd-classic')!
    const g = b.groups.find((x) => x.id === 'gr-c1')!
    expect(groupStatus(withGroup1(b, () => []), round, g).state).toBe('not_started')
    const mid = groupStatus(withGroup1(b, (i) => range(1, i === 0 ? 7 : 6)), round, g)
    expect(mid).toMatchObject({ state: 'on_course', thru: 6, nextHole: 7, problems: [] })
    expect(mid.lastScoreAt).toBe('2026-10-25T14:07:00Z')
    expect(groupStatus(withGroup1(b, () => range(1, 18)), round, g)).toMatchObject({ state: 'finished', thru: 18, nextHole: null })
  })

  it('flags a skipped hole and a player who fell behind the group', async () => {
    const b = await load()
    const round = b.rounds.find((r) => r.id === 'rd-classic')!
    const g = b.groups.find((x) => x.id === 'gr-c1')!
    const skipped = groupStatus(withGroup1(b, (i) => (i === 1 ? [1, 2, 4, 5] : range(1, 5))), round, g)
    expect(skipped.state).toBe('attention')
    expect(skipped.problems.join(' ')).toMatch(/no score on hole 3/)
    const behind = groupStatus(withGroup1(b, (i) => (i === 2 ? range(1, 4) : range(1, 9))), round, g)
    expect(behind.state).toBe('attention')
    expect(behind.problems.join(' ')).toMatch(/4 of 9 holes entered/)
    expect(groupStatus(withGroup1(b, (i) => (i === 0 ? range(1, 18) : range(1, 17))), round, g).state).toBe('attention')
  })

  it('lists every group in tee-time order and ignores withdrawn players', async () => {
    const b = await load()
    const round = b.rounds.find((r) => r.id === 'rd-classic')!
    const all = courseStatus(b, round)
    expect(all.map((s) => s.group.teeTime)).toEqual([...all.map((s) => s.group.teeTime)].sort())
    const g = b.groups.find((x) => x.id === 'gr-c1')!
    const wd = { ...withGroup1(b, (i) => (i === 3 ? [] : range(1, 18))), entries: b.entries.map((e) => (e.id === g.entryIds[3] ? { ...e, status: 'wd' as const } : e)) }
    expect(groupStatus(wd, round, g).state).toBe('finished')
  })
})

describe('thru before teeing off', () => {
  it('shows the tee time for a group that has not started the round in play', async () => {
    const b = await load()
    const g = b.groups.find((x) => x.id === 'gr-c1')!
    const lb = buildEventLeaderboard(withGroup1(b, () => []), 'rd-classic')
    const rows = lb.groups.flatMap((x) => x.rows).filter((r) => g.entryIds.includes(r.entryId))
    expect(rows.map((r) => r.thru)).toEqual(g.entryIds.map(() => '8:00 AM'))
    const playing = buildEventLeaderboard(withGroup1(b, () => range(1, 5)), 'rd-classic').groups.flatMap((x) => x.rows).find((r) => r.entryId === g.entryIds[0])!
    expect(playing.thru).toBe('5')
  })
})
