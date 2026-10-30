// Where every group is on the course: not started, on the course (thru N),
// finished, or needing attention because a hole is missing.
import { countingCards } from '../scoring/formats'
import { findGaps, rotation } from '../scoring/leaderboard'
import { entryStatusIn, nameOf, roundGroups, roundScores } from './derive'
import type { EventBundle, Group, Round } from './types'

export type GroupState = 'not_started' | 'on_course' | 'finished' | 'attention'

export interface GroupStatus {
  group: Group
  state: GroupState
  /** Holes every active entry in the group has finished (the group's "thru"). */
  thru: number
  /** Next hole the group should be playing, when on the course. */
  nextHole: number | null
  /** Why it needs attention: skipped holes, or entries out of step. */
  problems: string[]
  /** Latest score saved for the group, ISO time. */
  lastScoreAt: string | null
}

export function groupStatus(b: EventBundle, round: Round, group: Group): GroupStatus {
  const active = group.entryIds.map((id) => b.entries.find((e) => e.id === id)).filter((e) => !!e && entryStatusIn(b, e.id, round.id) === 'active')
  const scores = roundScores(b, round.id).filter((s) => group.entryIds.includes(s.entryId))
  const cards = countingCards(round.segments, scores)
  const order = rotation(group.startingHole)
  const problems: string[] = []
  const done = active.map((e) => {
    const holes = new Set(cards.get(e!.id)?.keys() ?? [])
    const gaps = findGaps(group.startingHole, holes)
    if (gaps.length) problems.push(`${nameOf(b, e!)}: no score on hole ${gaps.join(', ')}`)
    return { name: nameOf(b, e!), n: holes.size }
  })
  const max = Math.max(0, ...done.map((d) => d.n))
  const min = done.length ? Math.min(...done.map((d) => d.n)) : 0
  // Someone in the group is two or more holes ahead of someone else: a card was missed.
  if (max - min >= 2 || (max === 18 && min < 18))
    for (const d of done) if (d.n < max) problems.push(`${d.name}: ${d.n} of ${max} holes entered`)
  const lastScoreAt = scores.reduce<string | null>((a, s) => (!a || s.updatedAt > a ? s.updatedAt : a), null)
  const state: GroupState = problems.length ? 'attention' : max === 0 ? 'not_started' : min === 18 ? 'finished' : 'on_course'
  return { group, state, thru: min, nextHole: state === 'on_course' || state === 'attention' ? order[Math.min(min, 17)] ?? null : null, problems, lastScoreAt }
}

export function courseStatus(b: EventBundle, round: Round): GroupStatus[] {
  return roundGroups(b, round.id)
    .map((g) => groupStatus(b, round, g))
    .sort((x, y) => (x.group.teeTime ?? '').localeCompare(y.group.teeTime ?? '') || x.group.startingHole - y.group.startingHole || x.group.name.localeCompare(y.group.name, undefined, { numeric: true }))
}
