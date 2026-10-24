// The step-by-step New Event screen works on an EventSetup draft. These helpers
// build a blank draft, pre-fill one from an existing event (a template or last
// year's event), and check each step.
import type { EventSetup, RoundSetup } from '../data/repo'
import { defaultSegments, segmentsProblem } from '../scoring/formats'
import { DEFAULT_ALLOWANCES } from '../scoring/handicap'
import { addDays } from './derive'
import { NO_REGISTRATION, type EventBundle } from './types'

export const TIMEZONES = ['America/Chicago', 'America/Denver', 'America/New_York', 'America/Los_Angeles', 'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu']

export const FLIGHT_PRESETS = ['Championship', 'Presidents', 'First', 'Second', 'Third', 'Fourth', 'Senior', 'Ladies']

export const groupSizeFor = (teamSize: number) => (teamSize === 1 ? 4 : teamSize === 2 ? 2 : 1)

export function blankRound(date: string, teeId: string | null, teamSize: number): RoundSetup {
  return {
    date, teeId, segments: defaultSegments(teamSize), startType: 'tee_times', startTime: '08:00', startingHole: 1,
    groupSize: groupSizeFor(teamSize), teeIntervalMinutes: 10, useFlights: true,
  }
}

export function blankSetup(date: string, timezone: string): EventSetup {
  return {
    name: '', courseId: '', timezone, description: '', teamSize: 1, cumulative: true, tiebreak: 'share', isTemplate: false,
    scoringBasis: 'gross', netAllowances: DEFAULT_ALLOWANCES, maxHandicapIndex: null, hidePurse: false,
    rounds: [blankRound(date, null, 1)], flights: [], registration: { ...NO_REGISTRATION },
    questions: [], sideGames: [], payouts: [],
  }
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5)
const shiftIso = (iso: string | null, days: number) => (iso ? new Date(Date.parse(iso) + days * 864e5).toISOString() : null)

/** Pre-fill from an event's setup (no players), moving every date to start on `firstDate`. */
export function setupFromBundle(b: EventBundle, firstDate: string, name: string): EventSetup {
  const shift = daysBetween(b.rounds[0]?.date ?? b.event.date, firstDate)
  const roundNo = (id: string | null) => b.rounds.find((r) => r.id === id)?.roundNumber ?? null
  const flightName = (id: string | null) => b.flights.find((f) => f.id === id)?.name ?? null
  return {
    name, courseId: b.event.courseId, timezone: b.event.timezone, description: b.event.description,
    teamSize: b.event.teamSize, cumulative: b.event.cumulative, tiebreak: b.event.tiebreakPolicy, isTemplate: false,
    scoringBasis: b.event.scoringBasis, netAllowances: b.event.netAllowances, maxHandicapIndex: b.event.maxHandicapIndex, hidePurse: b.event.hidePurse,
    rounds: b.rounds.map((r) => ({
      date: addDays(r.date, shift), teeId: r.teeId, segments: r.segments, startType: r.startType, startTime: r.startTime,
      startingHole: r.startingHole, groupSize: r.groupSize, teeIntervalMinutes: r.teeIntervalMinutes, useFlights: r.useFlights,
    })),
    flights: b.flights.map((f) => f.name),
    registration: {
      ...b.event.registration,
      open: false,
      opensAt: shiftIso(b.event.registration.opensAt, shift),
      closesAt: shiftIso(b.event.registration.closesAt, shift),
    },
    questions: b.questions.map((q, i) => ({ label: q.label, kind: q.kind, choices: q.choices, required: q.required, perPlayer: q.perPlayer, sortOrder: i + 1 })),
    sideGames: b.sideGames.map((g, i) => ({
      roundNumber: roundNo(g.roundId) ?? 1, kind: g.kind, name: g.name, holes: g.holes, basis: g.basis, carryover: g.carryover,
      purseCents: g.purseCents, perHoleCents: g.perHoleCents, sortOrder: i + 1,
    })),
    payouts: b.payouts.map((t) => ({ basis: t.basis, roundNumber: roundNo(t.roundId), flightName: flightName(t.flightId), amountsCents: t.amountsCents })),
  }
}

/** "Jimmy Roger Showdown (template)" → "Jimmy Roger Showdown 2027"; "2026 Best of the Rest" → "2027 Best of the Rest". */
export function nameForYear(name: string, date: string): string {
  const year = date.slice(0, 4)
  const base = name.replace(/\(template\)/gi, '').replace(/\btemplate\b/gi, '').replace(/\b(19|20)\d{2}\b/g, '').replace(/\s{2,}/g, ' ').trim()
  return /^(19|20)\d{2}\b/.test(name.trim()) ? `${year} ${base}` : `${base} ${year}`
}

/** Change the team size, resetting formats that no longer fit. */
export function withTeamSize(s: EventSetup, teamSize: number): EventSetup {
  return {
    ...s,
    teamSize,
    rounds: s.rounds.map((r) => ({
      ...r,
      segments: segmentsProblem(r.segments, teamSize) ? defaultSegments(teamSize) : r.segments,
      groupSize: groupSizeFor(teamSize),
    })),
    questions: teamSize === 1 ? s.questions.map((q) => ({ ...q, perPlayer: false })) : s.questions,
  }
}

/** Set the number of rounds; new rounds copy the last one, a day later. */
export function withRoundCount(s: EventSetup, n: number): EventSetup {
  const rounds = s.rounds.slice(0, n)
  while (rounds.length < n) {
    const last = rounds[rounds.length - 1]!
    rounds.push({ ...last, date: addDays(last.date, 1) })
  }
  return {
    ...s,
    rounds,
    sideGames: s.sideGames.filter((g) => g.roundNumber <= n),
    payouts: s.payouts.filter((p) => p.roundNumber === null || p.roundNumber <= n),
    cumulative: n === 1 ? true : s.cumulative,
  }
}

/** The competitions that can carry place money, as the Payouts tab shows them. */
export function draftPayoutSlots(s: EventSetup): { basis: 'gross' | 'net'; roundNumber: number | null; flightName: string | null; label: string }[] {
  const bases: ('gross' | 'net')[] = s.scoringBasis === 'both' ? ['gross', 'net'] : [s.scoringBasis]
  const scopes: (number | null)[] = s.rounds.length === 1 || s.cumulative ? [null] : s.rounds.map((_, i) => i + 1)
  const out: { basis: 'gross' | 'net'; roundNumber: number | null; flightName: string | null; label: string }[] = []
  for (const basis of bases)
    for (const rn of scopes) {
      const rounds = rn === null ? s.rounds : [s.rounds[rn - 1]!]
      const flighted = s.flights.length > 0 && rounds.some((r) => r.useFlights)
      const prefix = [bases.length > 1 ? (basis === 'gross' ? 'Gross' : 'Net') : '', rn === null ? (s.rounds.length > 1 ? 'Overall' : '') : `Round ${rn}`].filter(Boolean).join(' · ')
      if (flighted) for (const f of s.flights) out.push({ basis, roundNumber: rn, flightName: f, label: [prefix, f].filter(Boolean).join(' · ') })
      else out.push({ basis, roundNumber: rn, flightName: null, label: prefix || 'Whole field' })
    }
  return out
}

export type StepKey = 'start' | 'basics' | 'format' | 'flights' | 'teesheet' | 'registration' | 'prizes' | 'review'

export const STEPS: { key: StepKey; label: string }[] = [
  { key: 'start', label: 'Start' },
  { key: 'basics', label: 'Event & days' },
  { key: 'format', label: 'Format' },
  { key: 'flights', label: 'Flights' },
  { key: 'teesheet', label: 'Tee sheet' },
  { key: 'registration', label: 'Registration' },
  { key: 'prizes', label: 'Scoring & prizes' },
  { key: 'review', label: 'Review' },
]

/** Problems that stop the setup moving past a step (empty = fine). */
export function stepProblems(s: EventSetup, step: StepKey, teeHoleCounts: Record<string, number> = {}): string[] {
  const p: string[] = []
  if (step === 'basics') {
    if (!s.name.trim()) p.push('Give the event a name.')
    if (!s.courseId) p.push('Choose a course.')
    s.rounds.forEach((r, i) => {
      if (!r.date) p.push(`Round ${i + 1} needs a date.`)
      if (i > 0 && r.date && s.rounds[i - 1]!.date && r.date < s.rounds[i - 1]!.date) p.push(`Round ${i + 1} is before round ${i}.`)
      if (r.teeId && teeHoleCounts[r.teeId] !== undefined && teeHoleCounts[r.teeId] !== 18) p.push(`Round ${i + 1}'s tee has ${teeHoleCounts[r.teeId]} of 18 holes set up (you can finish that under Courses before scoring).`)
    })
  }
  if (step === 'format') s.rounds.forEach((r, i) => {
    const prob = segmentsProblem(r.segments, s.teamSize)
    if (prob) p.push(`Round ${i + 1}: ${prob}`)
  })
  if (step === 'flights') {
    const names = s.flights.map((f) => f.trim().toLowerCase())
    if (names.some((n) => !n)) p.push('Every flight needs a name.')
    if (new Set(names).size !== names.length) p.push('Flight names must be different.')
  }
  if (step === 'registration') {
    const r = s.registration
    if (r.maxPlayers !== null && (r.maxPlayers < 1 || r.maxPlayers > 500)) p.push('Field limit must be 1–500 players.')
    if (r.maxPlayers !== null && s.teamSize > 1 && r.maxPlayers % s.teamSize !== 0) p.push(`Teams have ${s.teamSize} players, so the field limit should divide by ${s.teamSize}.`)
    if (r.opensAt && r.closesAt && r.opensAt >= r.closesAt) p.push('Registration must open before it closes.')
    s.questions.forEach((q) => {
      if (!q.label.trim()) p.push('Each sign-up question needs some text.')
      if (q.kind === 'choice' && q.choices.map((c) => c.trim()).filter(Boolean).length < 2) p.push(`"${q.label}" needs at least two options.`)
    })
  }
  if (step === 'prizes') s.sideGames.forEach((g) => {
    if (!g.name.trim()) p.push('Every side game needs a name.')
    if (g.kind !== 'skins' && g.holes.length === 0) p.push(`${g.name}: pick at least one hole.`)
  })
  return p
}

export const allProblems = (s: EventSetup, counts: Record<string, number> = {}) =>
  (['basics', 'format', 'flights', 'registration', 'prizes'] as StepKey[]).flatMap((k) => stepProblems(s, k, counts).filter((x) => !/holes set up/.test(x)))
