// UI-facing helpers that turn an EventBundle into what screens need.
import { computeLeaderboard, type Leaderboard } from '../scoring/leaderboard'
import { entryName, type Entry, type EventBundle, type Group, type Score } from './types'

export function scoreMap(scores: Score[]): Map<string, Map<number, number>> {
  const m = new Map<string, Map<number, number>>()
  for (const s of scores) {
    let e = m.get(s.entryId)
    if (!e) m.set(s.entryId, (e = new Map()))
    e.set(s.hole, s.strokes)
  }
  return m
}

export function groupOfEntry(groups: Group[], entryId: string): Group | undefined {
  return groups.find((g) => g.entryIds.includes(entryId))
}

export function nameOf(b: EventBundle, entry: Entry): string {
  return entryName(entry, b.players, b.teams)
}

export function buildLeaderboard(b: EventBundle): Leaderboard {
  return computeLeaderboard({
    holes: b.holes.map((h) => ({ number: h.number, par: h.par })),
    entries: b.entries.map((e) => ({
      id: e.id,
      name: nameOf(b, e),
      status: e.status,
      startingHole: groupOfEntry(b.groups, e.id)?.startingHole ?? 1,
    })),
    scores: scoreMap(b.scores),
    tiebreak: b.event.tiebreakPolicy,
    final: b.round.status === 'finalized',
  })
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
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
