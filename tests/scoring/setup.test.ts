import { describe, expect, it } from 'vitest'
import { DemoRepo } from '../../src/data/demoRepo'
import { buildEventLeaderboard, leaderboardPayouts, netCards, skinsFor } from '../../src/domain/derive'
import { allProblems, blankSetup, draftPayoutSlots, groupTeeTime, nameForYear, setupFromBundle, stepProblems, withRoundCount, withTeamSize } from '../../src/domain/setup'

// The demo store uses localStorage and BroadcastChannel when present; vitest runs in node without them.
const repo = () => new DemoRepo()

describe('setup drafts', () => {
  it('names next year’s edition from a template or a dated name', () => {
    expect(nameForYear('Jimmy Roger Showdown (template)', '2027-04-17')).toBe('Jimmy Roger Showdown 2027')
    expect(nameForYear('2026 Best of the Rest', '2027-10-16')).toBe('2027 Best of the Rest')
    expect(nameForYear('City Championship 2025', '2026-08-01')).toBe('City Championship 2026')
  })

  it('copies an event’s setup, moving every date and mapping rounds and flights by number and name', async () => {
    const r = repo()
    const b = await r.loadBundle('ev-showdown')
    const s = setupFromBundle(b, '2030-04-20', 'Showdown 2030')
    expect(s.rounds.map((x) => x.date)).toEqual(['2030-04-20', '2030-04-21'])
    expect(s.teamSize).toBe(3)
    expect(s.flights).toEqual(['Championship', 'First'])
    expect(s.sideGames.map((g) => [g.kind, g.roundNumber])).toEqual([['closest_to_pin', 1], ['skins', 1]])
    expect(s.payouts.map((p) => p.flightName)).toEqual(['Championship', 'First'])
    expect(s.registration.open).toBe(false)
    expect(allProblems(s)).toEqual([])
  })

  it('creates the whole event from a draft (demo store)', async () => {
    const r = repo()
    const b = await r.loadBundle('ev-showdown')
    const id = await r.createEventSetup({ ...setupFromBundle(b, '2030-04-20', 'Showdown 2030'), questions: [{ label: 'Cart?', kind: 'yes_no', choices: [], required: true, perPlayer: true, sortOrder: 1 }] })
    const nb = await r.loadBundle(id)
    expect(nb.rounds).toHaveLength(2)
    expect(nb.flights.map((f) => f.name)).toEqual(['Championship', 'First'])
    expect(nb.sideGames).toHaveLength(2)
    expect(nb.payouts.every((p) => nb.flights.some((f) => f.id === p.flightId))).toBe(true)
    expect(nb.questions.map((q) => q.label)).toEqual(['Cart?'])
    expect(nb.players).toHaveLength(0)
  })

  it('changing team size resets formats that no longer fit', () => {
    const s = withTeamSize(blankSetup('2027-01-01', 'America/Chicago'), 3)
    expect(s.rounds[0]!.segments[0]!.method).toBe('scramble')
    expect(s.rounds[0]!.groupSize).toBe(1)
  })

  it('adding rounds copies the last one a day later; payout slots follow the setup', () => {
    let s = withRoundCount({ ...blankSetup('2027-04-17', 'America/Chicago'), flights: ['A', 'B'] }, 2)
    expect(s.rounds.map((r) => r.date)).toEqual(['2027-04-17', '2027-04-18'])
    expect(draftPayoutSlots(s).map((x) => x.label)).toEqual(['Overall · A', 'Overall · B'])
    s = { ...s, cumulative: false, scoringBasis: 'both', rounds: s.rounds.map((r, i) => ({ ...r, useFlights: i === 1 })) }
    expect(draftPayoutSlots(s).map((x) => x.label)).toEqual(['Gross · Round 1', 'Gross · Round 2 · A', 'Gross · Round 2 · B', 'Net · Round 1', 'Net · Round 2 · A', 'Net · Round 2 · B'])
  })

  it('two groups per tee time share each time, then step by the interval', () => {
    expect([0, 1, 2, 3, 4].map((n) => groupTeeTime('08:00', n, 15, 2))).toEqual(['08:00', '08:00', '08:15', '08:15', '08:30'])
    expect([0, 1, 2].map((n) => groupTeeTime('07:40', n, 10))).toEqual(['07:40', '07:50', '08:00'])
    expect(groupTeeTime('12:50', 2, 10, 1)).toBe('13:10')
  })

  it('checks each step', () => {
    const s = blankSetup('2027-04-17', 'America/Chicago')
    expect(stepProblems(s, 'basics')).toEqual(['Give the event a name.', 'Choose a course.'])
    expect(stepProblems({ ...s, flights: ['A', 'a'] }, 'flights')).toEqual(['Flight names must be different.'])
    expect(stepProblems({ ...s, teamSize: 3, registration: { ...s.registration, maxPlayers: 100 } }, 'registration')[0]).toMatch(/divide by 3/)
  })
})

describe('net, skins and payouts on the demo event', () => {
  it('works out net cards from Handicap Indexes and the tee rating', async () => {
    const b = await repo().loadBundle('ev-showdown')
    const { cards, excluded } = netCards(b, b.rounds[0]!)
    expect(excluded.size).toBe(0)
    const gross = buildEventLeaderboard(b, b.rounds[0]!.id, 'gross').groups.flatMap((g) => g.rows)
    const net = buildEventLeaderboard(b, b.rounds[0]!.id, 'net').groups.flatMap((g) => g.rows)
    for (const n of net) {
      const g = gross.find((x) => x.entryId === n.entryId)!
      expect(n.gross!).toBeLessThanOrEqual(g.gross!) // every demo player gets strokes
      expect(cards.get(n.entryId)!.size).toBe(18)
    }
  })

  it('a missing Handicap Index keeps the entry off the net board instead of guessing', async () => {
    const b = await repo().loadBundle('ev-showdown')
    const pid = b.teams[0]!.playerIds[0]!
    const without = { ...b, handicaps: b.handicaps.filter((h) => h.playerId !== pid) }
    const row = buildEventLeaderboard(without, 'overall', 'net').groups.flatMap((g) => g.rows).find((r) => r.entryId === b.entries.find((e) => e.teamId === b.teams[0]!.id)!.id)!
    expect(row.position).toBeNull()
    expect(row.note).toMatch(/Handicap Index/)
  })

  it('pays each flight from its own table and computes skins from round 1 scores', async () => {
    const b = await repo().loadBundle('ev-showdown')
    const lb = buildEventLeaderboard(b, 'overall', 'gross')
    const pay = leaderboardPayouts(b, lb, 'gross', 'overall')
    const champ = lb.groups.find((g) => g.name === 'Championship')!
    const first = champ.rows.find((r) => r.position === 1)!
    expect(pay.get(first.entryId)).toBeGreaterThan(0)
    const skins = skinsFor(b, b.sideGames.find((g) => g.kind === 'skins')!)
    expect(skins.holes.every((h) => h.state !== 'open')).toBe(true) // round 1 is complete
    expect([...skins.won.values()].reduce((a, c) => a + c, 0)).toBe(skins.totalSkins)
  })
})
