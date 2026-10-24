// Fictional demo data. No real people, clubs or courses.
import type {
  Course,
  Entry,
  EventLogEntry,
  Flight,
  GolfEvent,
  Group,
  Hole,
  PayoutTable,
  Player,
  PlayerContact,
  PlayerHandicap,
  Registration,
  RegistrationAnswer,
  RegistrationQuestion,
  Round,
  Score,
  ScoreAudit,
  SideGame,
  SideGameResult,
  StaffMember,
  Team,
  Tee,
} from '../domain/types'

import { DEFAULT_ALLOWANCES } from '../scoring/handicap'

export interface DemoState {
  schema: 4
  role: 'admin' | 'scorekeeper' | 'spectator'
  organizers: boolean
  courses: (Course & { ownerId: string })[]
  tees: Tee[]
  holes: Hole[]
  events: GolfEvent[]
  rounds: Round[]
  flights: Flight[]
  players: Player[]
  contacts: PlayerContact[]
  teams: Team[]
  entries: Entry[]
  groups: Group[]
  scores: Score[]
  audit: ScoreAudit[]
  log: EventLogEntry[]
  staff: StaffMember[]
  registrations: Registration[]
  handicaps: PlayerHandicap[]
  questions: RegistrationQuestion[]
  answers: RegistrationAnswer[]
  sideGames: SideGame[]
  sideGameResults: SideGameResult[]
  payouts: PayoutTable[]
}

/** Defaults for event fields added with the step-by-step setup. */
const EXTRAS = { scoringBasis: 'gross' as const, netAllowances: DEFAULT_ALLOWANCES, maxHandicapIndex: null, hidePurse: false }
const REG_EXTRAS = { opensAt: null, waitlistLimit: null, showParticipants: false }
const SHEET = (startTime: string | null, groupSize: number) => ({ startTime, startingHole: 1, groupSize, teeIntervalMinutes: 10 })

export const DEMO_USER = { id: 'demo-user', email: 'you@demo.invalid' }

const PARS = [4, 5, 3, 4, 4, 3, 5, 4, 4, 4, 4, 3, 5, 4, 3, 4, 5, 4]
const YARDS = [384, 512, 168, 401, 357, 189, 538, 412, 366, 395, 342, 155, 521, 428, 176, 371, 547, 419]
const SI = [7, 3, 15, 1, 11, 17, 5, 9, 13, 8, 12, 18, 4, 2, 16, 14, 6, 10]

const NAMES: [string, string][] = [
  ['Avery', 'Calloway'], ['Brooks', 'Hensley'], ['Carter', 'Delgado'], ['Dana', 'Whitfield'],
  ['Emerson', 'Pike'], ['Finley', 'Ortega'], ['Gray', 'Lindqvist'], ['Harper', 'Moss'],
  ['Indy', 'Ramsey'], ['Jules', 'Barrow'], ['Kai', 'Thornton'], ['Logan', 'Vance'],
  ['Morgan', 'Ashby'], ['Noel', 'Garza'], ['Oakley', 'Prentice'], ['Parker', 'Quill'],
  ['Quinn', 'Rowan'], ['Reese', 'Salazar'], ['Sawyer', 'Tate'], ['Toby', 'Underhill'],
  ['Uma', 'Vasquez'], ['Wren', 'Yardley'], ['Xavi', 'Zamora'], ['Yael', 'Abbott'],
]

// Small deterministic PRNG so the demo looks the same every time.
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function holeScore(par: number, r: () => number, skill: number): number {
  const x = r() + skill
  if (x < 0.015) return par - 2
  if (x < 0.17) return par - 1
  if (x < 0.66) return par
  if (x < 0.92) return par + 1
  if (x < 0.985) return par + 2
  return par + 3
}

export function buildDemoState(): DemoState {
  const now = new Date().toISOString()
  const today = new Date().toISOString().slice(0, 10)
  const r = rng(42)

  const course = { id: 'c-mesquite', ownerId: DEMO_USER.id, name: 'Mesquite Ridge Golf Club (fictional)', city: 'Demo City, TX' }
  const tee: Tee = { id: 't-white', courseId: course.id, name: 'White', rating: 70.4, slope: 124 }
  const holes: Hole[] = PARS.map((par, i) => ({ teeId: tee.id, number: i + 1, par, yardage: YARDS[i]!, strokeIndex: SI[i]! }))

  const state: DemoState = {
    schema: 4,
    role: 'admin',
    organizers: true,
    courses: [course],
    tees: [tee],
    holes,
    events: [],
    rounds: [],
    flights: [],
    players: [],
    contacts: [],
    teams: [],
    entries: [],
    groups: [],
    scores: [],
    audit: [],
    log: [],
    staff: [],
    registrations: [],
    handicaps: [],
    questions: [],
    answers: [],
    sideGames: [],
    sideGameResults: [],
    payouts: [],
  }

  // ── Event 1: individual stroke play, in progress ──
  const e1: GolfEvent = {
    id: 'ev-classic', publicCode: 'DEMO01', name: 'Demo Fall Classic', courseId: course.id, date: today,
    timezone: 'America/Chicago', description: 'Fictional 16-player individual stroke play event for trying the app.',
    status: 'in_progress', tiebreakPolicy: 'card_back', createdAt: now,
    registration: { open: false, closesAt: null, maxPlayers: 16, entryFeeCents: 6000, paymentInstructions: 'Pay at the pro shop before your tee time.', ...REG_EXTRAS },
    teamSize: 1, cumulative: true, isTemplate: false, ...EXTRAS,
  }
  const r1: Round = { id: 'rd-classic', eventId: e1.id, roundNumber: 1, date: today, teeId: tee.id, segments: [{ from: 1, to: 18, method: 'individual', count: 1 }], useFlights: true, startType: 'tee_times', status: 'open', ...SHEET('08:00', 4) }
  state.events.push(e1)
  state.rounds.push(r1)
  const thru = [12, 9, 5, 0]
  for (let g = 0; g < 4; g++) {
    const group: Group = { id: `gr-c${g + 1}`, roundId: r1.id, name: `Group ${g + 1}`, teeTime: `08:${String(g * 10).padStart(2, '0')}`, startingHole: 1, entryIds: [] }
    for (let k = 0; k < 4; k++) {
      const idx = g * 4 + k
      const [first, last] = NAMES[idx]!
      const player: Player = { id: `pl-c${idx}`, eventId: e1.id, firstName: first, lastName: last, teeId: null }
      const entry: Entry = { id: `en-c${idx}`, eventId: e1.id, kind: 'player', playerId: player.id, teamId: null, status: 'active', statusNote: '', flightId: null }
      state.players.push(player)
      state.contacts.push({ playerId: player.id, email: `${first.toLowerCase()}@example.com`, phone: '' })
      state.entries.push(entry)
      group.entryIds.push(entry.id)
      const skill = (idx % 5) * 0.07 - 0.1
      for (let h = 1; h <= thru[g]!; h++) {
        const strokes = holeScore(PARS[h - 1]!, r, skill)
        state.scores.push({ id: `sc-c${idx}-${h}`, roundId: r1.id, entryId: entry.id, playerId: null, hole: h, strokes, version: 1, updatedAt: now, updatedBy: DEMO_USER.id })
        state.audit.push({ id: `au-c${idx}-${h}`, roundId: r1.id, entryId: entry.id, playerId: null, hole: h, action: 'insert', oldStrokes: null, newStrokes: strokes, reason: '', changedBy: DEMO_USER.id, changedByLabel: 'demo scorekeeper', changedAt: now })
      }
    }
    state.groups.push(group)
  }
  // One withdrawal to show how WD is displayed.
  state.entries.find((e) => e.id === 'en-c11')!.status = 'wd'
  state.entries.find((e) => e.id === 'en-c11')!.statusNote = 'Left after 5 holes'
  state.staff.push(
    { id: 'st-c-admin', eventId: e1.id, email: DEMO_USER.email, role: 'admin', userId: DEMO_USER.id, groupIds: [] },
    { id: 'st-c-sk', eventId: e1.id, email: 'scorer@demo.invalid', role: 'scorekeeper', userId: DEMO_USER.id, groupIds: ['gr-c1'] },
  )
  state.log.push({ id: 'lg-1', eventId: e1.id, action: 'status:published->in_progress', detail: '', actorLabel: DEMO_USER.email, at: now })

  // ── Event 2: two-person scramble, draft, shotgun ──
  const e2: GolfEvent = {
    id: 'ev-scramble', publicCode: 'DEMO02', name: 'Demo Charity Scramble', courseId: course.id, date: today,
    timezone: 'America/Chicago', description: 'Fictional two-person scramble with a shotgun start. Registration is open.',
    status: 'published', tiebreakPolicy: 'share', createdAt: now,
    registration: {
      open: true,
      closesAt: new Date(Date.now() + 7 * 864e5).toISOString(),
      maxPlayers: 16,
      entryFeeCents: 7500,
      paymentInstructions: 'Pay by cash or check at check-in, or Venmo the organizer with your team name.',
      opensAt: null, waitlistLimit: 8, showParticipants: true,
    },
    teamSize: 2, cumulative: true, isTemplate: false, ...EXTRAS,
  }
  const r2: Round = { id: 'rd-scramble', eventId: e2.id, roundNumber: 1, date: today, teeId: tee.id, segments: [{ from: 1, to: 18, method: 'scramble', count: 1 }], useFlights: true, startType: 'shotgun', status: 'open', ...SHEET('13:00', 2) }
  state.events.push(e2)
  state.questions.push(
    { id: 'q-cart', eventId: e2.id, label: 'Do you need a cart?', kind: 'yes_no', choices: [], required: true, perPlayer: true, sortOrder: 1 },
    { id: 'q-shirt', eventId: e2.id, label: 'Shirt size', kind: 'choice', choices: ['S', 'M', 'L', 'XL', 'XXL'], required: false, perPlayer: true, sortOrder: 2 },
  )
  state.rounds.push(r2)
  const teamNames = ['Sand Savers', 'Dogleg Duo', 'Fairway Finders', 'Pin Seekers', 'Bogey Busters', 'Lip Outs']
  for (let t = 0; t < 6; t++) {
    const ids: string[] = []
    for (let k = 0; k < 2; k++) {
      const idx = 12 + t * 2 + k
      const [first, last] = NAMES[idx]!
      const p: Player = { id: `pl-s${idx}`, eventId: e2.id, firstName: first, lastName: last, teeId: null }
      state.players.push(p)
      state.contacts.push({ playerId: p.id, email: `${first.toLowerCase()}@example.com`, phone: '' })
      ids.push(p.id)
    }
    const team: Team = { id: `tm-s${t}`, eventId: e2.id, name: teamNames[t]!, playerIds: ids }
    state.registrations.push({
      id: `rg-s${t}`, eventId: e2.id, ref: `DMR${String(t + 1).padStart(3, '0')}`, status: 'confirmed', teamName: team.name, teamId: team.id,
      registrantNote: '', paymentStatus: t < 3 ? 'paid' : 'unpaid', paymentMethod: t < 2 ? 'online' : t === 2 ? 'cash' : '',
      amountPaidCents: t < 3 ? 15000 : null, adminNote: '', source: 'online', createdAt: now,
      people: ids.map((pid, k) => {
        const pl = state.players.find((x) => x.id === pid)!
        return { position: k + 1, firstName: pl.firstName, lastName: pl.lastName, email: `${pl.firstName.toLowerCase()}@example.com`, phone: '', handicapIndex: Math.round((4 + ((t * 7 + k * 5) % 20) + 0.3) * 10) / 10, playerId: pid }
      }),
    })
    ids.forEach((pid, k) => state.handicaps.push({ playerId: pid, handicapIndex: Math.round((4 + ((t * 7 + k * 5) % 20) + 0.3) * 10) / 10, source: 'Self-reported at registration', asOf: now.slice(0, 10) }))
    state.teams.push(team)
    state.entries.push({ id: `en-s${t}`, eventId: e2.id, kind: 'team', playerId: null, teamId: team.id, status: 'active', statusNote: '', flightId: null })
  }
  ;[1, 4, 7].forEach((start, g) => {
    state.groups.push({ id: `gr-s${g + 1}`, roundId: r2.id, name: `Hole ${start}`, teeTime: '13:00', startingHole: start, entryIds: [`en-s${g * 2}`, `en-s${g * 2 + 1}`] })
  })
  state.staff.push({ id: 'st-s-admin', eventId: e2.id, email: DEMO_USER.email, role: 'admin', userId: DEMO_USER.id, groupIds: [] })

  // ── Event 3: 3-person teams, best 2 balls of 3, two days, flighted; day 1 done ──
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10)
  const e3: GolfEvent = {
    id: 'ev-showdown', publicCode: 'DEMO03', name: 'Demo Spring Showdown', courseId: course.id, date: today,
    timezone: 'America/Chicago', description: 'Fictional 3-person teams, best 2 balls of 3 count on every hole, over two days. Two flights.',
    status: 'in_progress', tiebreakPolicy: 'share', createdAt: now,
    registration: { open: false, closesAt: null, maxPlayers: 36, entryFeeCents: 25000, paymentInstructions: 'Pay at check-in.', ...REG_EXTRAS },
    teamSize: 3, cumulative: true, isTemplate: false, ...EXTRAS, scoringBasis: 'both',
  }
  state.events.push(e3)
  const best2 = [{ from: 1, to: 18, method: 'best_ball' as const, count: 2 }]
  const d1: Round = { id: 'rd-sd1', eventId: e3.id, roundNumber: 1, date: today, teeId: tee.id, segments: best2, useFlights: true, startType: 'shotgun', status: 'finalized', ...SHEET('08:30', 2) }
  const d2: Round = { id: 'rd-sd2', eventId: e3.id, roundNumber: 2, date: tomorrow, teeId: tee.id, segments: best2, useFlights: true, startType: 'shotgun', status: 'open', ...SHEET('08:30', 2) }
  state.rounds.push(d1, d2)
  const flights: Flight[] = [
    { id: 'fl-champ', eventId: e3.id, name: 'Championship', sortOrder: 1 },
    { id: 'fl-first', eventId: e3.id, name: 'First', sortOrder: 2 },
  ]
  state.flights.push(...flights)
  const trioNames = ['Three Putts', 'Hook Line & Sinker', 'Grip It', 'Shank Redemption', 'Tee Party', 'Fore Play']
  trioNames.forEach((name, t) => {
    const ids: string[] = []
    for (let k = 0; k < 3; k++) {
      const [first, last] = NAMES[(t * 3 + k) % NAMES.length]!
      const p: Player = { id: `pl-d${t}-${k}`, eventId: e3.id, firstName: first, lastName: last, teeId: null }
      state.players.push(p)
      state.contacts.push({ playerId: p.id, email: '', phone: '' })
      state.handicaps.push({ playerId: p.id, handicapIndex: Math.round(((t * 3 + k * 7) % 22 + 1.4) * 10) / 10, source: 'Entered by admin', asOf: today })
      ids.push(p.id)
    }
    state.teams.push({ id: `tm-d${t}`, eventId: e3.id, name, playerIds: ids })
    const entry: Entry = { id: `en-d${t}`, eventId: e3.id, kind: 'team', playerId: null, teamId: `tm-d${t}`, status: 'active', statusNote: '', flightId: t < 3 ? 'fl-champ' : 'fl-first' }
    state.entries.push(entry)
    const skill = t * 0.04 - 0.08
    for (const [round, thruN] of [[d1, 18], [d2, t % 2 ? 9 : 6]] as const)
      for (let h = 1; h <= thruN; h++)
        ids.forEach((pid, k) => {
          // The odd player picks up now and then: a missing score, never zero.
          if ((h + k + t) % 11 === 0) return
          const strokes = holeScore(PARS[h - 1]!, r, skill)
          state.scores.push({ id: `sc-d${round.roundNumber}-${t}-${k}-${h}`, roundId: round.id, entryId: entry.id, playerId: pid, hole: h, strokes, version: 1, updatedAt: now, updatedBy: DEMO_USER.id })
        })
  })
  ;[1, 4, 7].forEach((start, g) => {
    for (const round of [d1, d2])
      state.groups.push({ id: `gr-d${round.roundNumber}-${g}`, roundId: round.id, name: `Hole ${start}`, teeTime: '08:30', startingHole: start, entryIds: [`en-d${g * 2}`, `en-d${g * 2 + 1}`] })
  })
  state.staff.push({ id: 'st-d-admin', eventId: e3.id, email: DEMO_USER.email, role: 'admin', userId: DEMO_USER.id, groupIds: [] })
  const par3s = holes.filter((h) => h.par === 3).map((h) => h.number)
  state.sideGames.push(
    { id: 'sg-ctp1', eventId: e3.id, roundId: d1.id, kind: 'closest_to_pin', name: 'Closest to the pin', holes: par3s, basis: 'gross', carryover: false, purseCents: 0, perHoleCents: 5000, sortOrder: 1, entryIds: [] },
    { id: 'sg-skins1', eventId: e3.id, roundId: d1.id, kind: 'skins', name: 'Gross skins', holes: [], basis: 'gross', carryover: true, purseCents: 30000, perHoleCents: 0, sortOrder: 2, entryIds: [] },
  )
  state.sideGameResults.push(
    { gameId: 'sg-ctp1', hole: par3s[0]!, playerId: 'pl-d1-0', entryId: 'en-d1', note: "6' 4\"" },
    { gameId: 'sg-ctp1', hole: par3s[1]!, playerId: 'pl-d4-2', entryId: 'en-d4', note: "11' 0\"" },
  )
  state.payouts.push(
    { id: 'po-champ', eventId: e3.id, basis: 'gross', roundId: null, flightId: 'fl-champ', amountsCents: [45000, 30000, 15000] },
    { id: 'po-first', eventId: e3.id, basis: 'gross', roundId: null, flightId: 'fl-first', amountsCents: [30000, 20000, 10000] },
  )
  state.log.push({ id: 'lg-d1', eventId: e3.id, action: 'finalized', detail: 'Round 1', actorLabel: DEMO_USER.email, at: now })

  // ── Template: the same event set up for next year ──
  state.events.push({ ...e3, id: 'ev-showdown-tpl', publicCode: 'DEMOT1', name: 'Demo Spring Showdown (template)', status: 'draft', isTemplate: true, description: e3.description })
  state.rounds.push({ ...d1, id: 'rd-tpl1', eventId: 'ev-showdown-tpl', status: 'open' }, { ...d2, id: 'rd-tpl2', eventId: 'ev-showdown-tpl', status: 'open' })
  state.flights.push(...flights.map((f) => ({ ...f, id: `${f.id}-tpl`, eventId: 'ev-showdown-tpl' })))
  state.staff.push({ id: 'st-tpl-admin', eventId: 'ev-showdown-tpl', email: DEMO_USER.email, role: 'admin', userId: DEMO_USER.id, groupIds: [] })
  return state
}
