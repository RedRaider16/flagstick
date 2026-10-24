// Glue between an EventBundle and the Leaderboard component.
import type { BoardRound, CardDetail } from '../components/Leaderboard'
import { roundHoles, type Scope } from '../domain/derive'
import { playerName, type EventBundle } from '../domain/types'
import { countingPar, segmentFor } from '../scoring/formats'

export function boardRounds(b: EventBundle, scope: Scope): BoardRound[] {
  const rounds = scope === 'overall' ? b.rounds : b.rounds.filter((r) => r.id === scope)
  return rounds
    .filter((r) => r.teeId)
    .map((r) => ({
      id: r.id,
      label: `Round ${r.roundNumber}`,
      holes: roundHoles(b, r).map((h) => ({ number: h.number, par: countingPar(segmentFor(r.segments, h.number), h.par) })),
    }))
}

/** Player lines for best-ball holes; undefined when the round has none. */
export function cardDetail(b: EventBundle): CardDetail {
  return (entryId, roundId) => {
    const round = b.rounds.find((r) => r.id === roundId)
    const entry = b.entries.find((e) => e.id === entryId)
    if (!round || !entry?.teamId || !round.segments.some((s) => s.method === 'best_ball')) return []
    const team = b.teams.find((t) => t.id === entry.teamId)
    return (team?.playerIds ?? []).map((pid) => {
      const p = b.players.find((x) => x.id === pid)
      const scores = new Map<number, number>()
      for (const s of b.scores) if (s.roundId === roundId && s.entryId === entryId && s.playerId === pid) scores.set(s.hole, s.strokes)
      return { name: p ? playerName(p) : 'Player', scores }
    })
  }
}
