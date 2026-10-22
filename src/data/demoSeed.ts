// Fictional demo data. No real people, clubs or courses.
import type {
  Course,
  Entry,
  EventLogEntry,
  GolfEvent,
  Group,
  Hole,
  Player,
  PlayerContact,
  Round,
  Score,
  ScoreAudit,
  StaffMember,
  Team,
  Tee,
} from '../domain/types'

export interface DemoState {
  schema: 1
  role: 'admin' | 'scorekeeper' | 'spectator'
  organizers: boolean
  courses: (Course & { ownerId: string })[]
  tees: Tee[]
  holes: Hole[]
  events: GolfEvent[]
  rounds: Round[]
  players: Player[]
  contacts: PlayerContact[]
  teams: Team[]
  entries: Entry[]
  groups: Group[]
  scores: Score[]
  audit: ScoreAudit[]
  log: EventLogEntry[]
  staff: StaffMember[]
}

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
  const tee: Tee = { id: 't-white', courseId: course.id, name: 'White', rating: null, slope: null }
  const holes: Hole[] = PARS.map((par, i) => ({ teeId: tee.id, number: i + 1, par, yardage: YARDS[i]!, strokeIndex: SI[i]! }))

  const state: DemoState = {
    schema: 1,
    role: 'admin',
    organizers: true,
    courses: [course],
    tees: [tee],
    holes,
    events: [],
    rounds: [],
    players: [],
    contacts: [],
    teams: [],
    entries: [],
    groups: [],
    scores: [],
    audit: [],
    log: [],
    staff: [],
  }

  // ── Event 1: individual stroke play, in progress ──
  const e1: GolfEvent = {
    id: 'ev-classic', publicCode: 'DEMO01', name: 'Demo Fall Classic', courseId: course.id, date: today,
    timezone: 'America/Chicago', description: 'Fictional 16-player individual stroke play event for trying the app.',
    status: 'in_progress', tiebreakPolicy: 'card_back', createdAt: now,
  }
  const r1: Round = { id: 'rd-classic', eventId: e1.id, roundNumber: 1, date: today, teeId: tee.id, format: 'stroke_individual', startType: 'tee_times', status: 'open' }
  state.events.push(e1)
  state.rounds.push(r1)
  const thru = [12, 9, 5, 0]
  for (let g = 0; g < 4; g++) {
    const group: Group = { id: `gr-c${g + 1}`, roundId: r1.id, name: `Group ${g + 1}`, teeTime: `08:${String(g * 10).padStart(2, '0')}`, startingHole: 1, entryIds: [] }
    for (let k = 0; k < 4; k++) {
      const idx = g * 4 + k
      const [first, last] = NAMES[idx]!
      const player: Player = { id: `pl-c${idx}`, eventId: e1.id, firstName: first, lastName: last }
      const entry: Entry = { id: `en-c${idx}`, eventId: e1.id, kind: 'player', playerId: player.id, teamId: null, status: 'active', statusNote: '' }
      state.players.push(player)
      state.contacts.push({ playerId: player.id, email: `${first.toLowerCase()}@example.com`, phone: '' })
      state.entries.push(entry)
      group.entryIds.push(entry.id)
      const skill = (idx % 5) * 0.07 - 0.1
      for (let h = 1; h <= thru[g]!; h++) {
        const strokes = holeScore(PARS[h - 1]!, r, skill)
        state.scores.push({ id: `sc-c${idx}-${h}`, roundId: r1.id, entryId: entry.id, hole: h, strokes, version: 1, updatedAt: now, updatedBy: DEMO_USER.id })
        state.audit.push({ id: `au-c${idx}-${h}`, roundId: r1.id, entryId: entry.id, hole: h, action: 'insert', oldStrokes: null, newStrokes: strokes, reason: '', changedBy: DEMO_USER.id, changedByLabel: 'demo scorekeeper', changedAt: now })
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
    timezone: 'America/Chicago', description: 'Fictional two-person scramble with a shotgun start. Still in draft.',
    status: 'draft', tiebreakPolicy: 'share', createdAt: now,
  }
  const r2: Round = { id: 'rd-scramble', eventId: e2.id, roundNumber: 1, date: today, teeId: tee.id, format: 'scramble_2', startType: 'shotgun', status: 'open' }
  state.events.push(e2)
  state.rounds.push(r2)
  const teamNames = ['Sand Savers', 'Dogleg Duo', 'Fairway Finders', 'Pin Seekers', 'Bogey Busters', 'Lip Outs']
  for (let t = 0; t < 6; t++) {
    const ids: string[] = []
    for (let k = 0; k < 2; k++) {
      const idx = 12 + t * 2 + k
      const [first, last] = NAMES[idx]!
      const p: Player = { id: `pl-s${idx}`, eventId: e2.id, firstName: first, lastName: last }
      state.players.push(p)
      state.contacts.push({ playerId: p.id, email: '', phone: '' })
      ids.push(p.id)
    }
    const team: Team = { id: `tm-s${t}`, eventId: e2.id, name: teamNames[t]!, playerIds: ids }
    state.teams.push(team)
    state.entries.push({ id: `en-s${t}`, eventId: e2.id, kind: 'team', playerId: null, teamId: team.id, status: 'active', statusNote: '' })
  }
  ;[1, 4, 7].forEach((start, g) => {
    state.groups.push({ id: `gr-s${g + 1}`, roundId: r2.id, name: `Hole ${start}`, teeTime: '13:00', startingHole: start, entryIds: [`en-s${g * 2}`, `en-s${g * 2 + 1}`] })
  })
  state.staff.push({ id: 'st-s-admin', eventId: e2.id, email: DEMO_USER.email, role: 'admin', userId: DEMO_USER.id, groupIds: [] })
  return state
}
