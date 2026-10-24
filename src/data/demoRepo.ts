// Demo mode: fictional data held in this browser's localStorage. Nothing is shared
// with anyone else. It enforces the same rules as the database (status, locking,
// group assignment, version conflicts) so the demo behaves like the real thing.
import {
  NO_REGISTRATION,
  type Entry,
  type EntryStatus,
  type EventBundle,
  type EventStatus,
  type GolfEvent,
  type PaymentMethod,
  type PaymentStatus,
  type Registration,
  type RegistrantInput,
  type RegisterResult,
  type RegistrationSettings,
  type Score,
  type StaffRole,
} from '../domain/types'
import { defaultSegments, segmentFor, segmentsProblem } from '../scoring/formats'
import { validateHoleLayout, type HoleInput } from '../scoring/validation'
import { AppError } from './errors'
import { buildDemoState, DEMO_USER, type DemoState } from './demoSeed'
import type { Access, CourseDetail, EventPatch, GroupInput, NewEventInput, PlayerInput, Repo, RoundPatch, ScoreSlot, SessionUser } from './repo'

const KEY = 'flagstick-demo-v3'
const CHANNEL = 'flagstick-demo'

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2))
const nowIso = () => new Date().toISOString()
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

function loadState(): DemoState {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw) as DemoState
      if (s.schema === 3) return s
    }
  } catch {
    /* storage unavailable or corrupt — fall back to a fresh demo */
  }
  return buildDemoState()
}

export type DemoRole = DemoState['role']

export class DemoRepo implements Repo {
  readonly mode = 'demo' as const
  private s: DemoState = loadState()
  private listeners = new Set<() => void>()
  private authListeners = new Set<() => void>()
  private channel: BroadcastChannel | null = null

  constructor() {
    try {
      this.channel = new BroadcastChannel(CHANNEL)
      this.channel.onmessage = () => {
        this.s = loadState()
        this.listeners.forEach((l) => l())
        this.authListeners.forEach((l) => l())
      }
    } catch {
      this.channel = null
    }
  }

  // ── demo-only helpers ──
  get role(): DemoRole {
    return this.s.role
  }
  setRole(role: DemoRole) {
    this.s.role = role
    this.commit()
    this.authListeners.forEach((l) => l())
  }
  reset() {
    this.s = buildDemoState()
    this.commit()
    this.authListeners.forEach((l) => l())
  }

  private commit() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.s))
    } catch {
      /* storage full or disabled: the demo still works for this page view */
    }
    this.listeners.forEach((l) => l())
    this.channel?.postMessage('changed')
  }

  private event(id: string): GolfEvent {
    const e = this.s.events.find((x) => x.id === id)
    if (!e) throw new AppError('Event not found.', 'not_found')
    return e
  }
  private isAdmin(eventId: string) {
    return this.s.role === 'admin' && this.s.staff.some((x) => x.eventId === eventId && x.role === 'admin')
  }
  private requireAdmin(eventId: string) {
    if (!this.isAdmin(eventId)) throw new AppError('Admins only. (Switch the demo role to Admin.)', 'forbidden')
  }
  private log(eventId: string, action: string, detail = '') {
    this.s.log.push({ id: uid(), eventId, action, detail, actorLabel: `${DEMO_USER.email} (${this.s.role})`, at: nowIso() })
  }
  private scorekeeperGroups(eventId: string): string[] {
    const st = this.s.staff.find((x) => x.eventId === eventId && x.role === 'scorekeeper')
    if (st) return st.groupIds
    const rounds = this.s.rounds.filter((r) => r.eventId === eventId).map((r) => r.id)
    return this.s.groups.filter((g) => rounds.includes(g.roundId)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 1).map((g) => g.id)
  }

  // ── Session ──
  async currentUser(): Promise<SessionUser | null> {
    return this.s.role === 'spectator' ? null : DEMO_USER
  }
  onAuthChange(cb: () => void) {
    this.authListeners.add(cb)
    return () => void this.authListeners.delete(cb)
  }
  async requestSignIn(): Promise<void> {
    throw new AppError('Demo mode has no sign-in. Use the role switcher instead.', 'invalid')
  }
  async verifyCode(): Promise<void> {
    throw new AppError('Demo mode has no sign-in.', 'invalid')
  }
  async signOut() {
    this.setRole('spectator')
  }

  // ── Discovery ──
  async myEvents() {
    if (this.s.role === 'spectator') return []
    return clone(this.s.events).sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name))
  }
  async findEventByCode(code: string) {
    const e = this.s.events.find((x) => x.publicCode === code.trim().toUpperCase())
    if (!e) return null
    if (e.status === 'draft' && this.s.role === 'spectator') return null
    return clone(e)
  }
  async access(eventId: string): Promise<Access> {
    if (this.s.role === 'admin' && this.isAdmin(eventId)) return { isOrganizer: true, role: 'admin', groupIds: [] }
    if (this.s.role === 'scorekeeper') return { isOrganizer: false, role: 'scorekeeper', groupIds: this.scorekeeperGroups(eventId) }
    return { isOrganizer: false, role: null, groupIds: [] }
  }
  async isOrganizer() {
    return this.s.role === 'admin'
  }

  // ── Courses ──
  async listCourses() {
    return this.s.courses.map(({ ownerId: _o, ...c }) => clone(c))
  }
  async courseDetail(courseId: string): Promise<CourseDetail> {
    const c = this.s.courses.find((x) => x.id === courseId)
    if (!c) throw new AppError('Course not found.', 'not_found')
    const { ownerId: _o, ...course } = c
    const tees = this.s.tees.filter((t) => t.courseId === courseId)
    const holes = this.s.holes.filter((h) => tees.some((t) => t.id === h.teeId))
    return clone({ course, tees, holes })
  }
  async createCourse(name: string, city: string) {
    if (this.s.role !== 'admin') throw new AppError('Only organizers can add courses.', 'forbidden')
    if (!name.trim()) throw new AppError('Course name is required.', 'invalid')
    const id = uid()
    this.s.courses.push({ id, ownerId: DEMO_USER.id, name: name.trim(), city: city.trim() })
    this.commit()
    return id
  }
  async createTee(courseId: string, name: string) {
    if (this.s.role !== 'admin') throw new AppError('Only organizers can add tees.', 'forbidden')
    if (this.s.tees.some((t) => t.courseId === courseId && t.name.toLowerCase() === name.trim().toLowerCase()))
      throw new AppError('That tee already exists for this course.', 'invalid')
    const id = uid()
    this.s.tees.push({ id, courseId, name: name.trim(), rating: null, slope: null })
    this.commit()
    return id
  }
  async saveHoles(teeId: string, holes: HoleInput[]) {
    if (this.s.role !== 'admin') throw new AppError('Only organizers can edit courses.', 'forbidden')
    const errs = validateHoleLayout(holes)
    if (errs.length) throw new AppError(errs.join(' '), 'invalid')
    if (this.s.rounds.some((r) => r.teeId === teeId && r.status === 'finalized'))
      throw new AppError("This tee is used by a finalized round; its holes can't change.", 'conflict')
    this.s.holes = this.s.holes.filter((h) => h.teeId !== teeId)
    for (const h of holes) this.s.holes.push({ teeId, number: h.number, par: h.par, yardage: h.yardage, strokeIndex: h.strokeIndex })
    this.commit()
  }

  // ── Events ──
  async createEvent(input: NewEventInput) {
    if (this.s.role !== 'admin') throw new AppError('Only organizers can create events.', 'forbidden')
    let code: string
    do code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('')
    while (this.s.events.some((e) => e.publicCode === code))
    const problem = segmentsProblem(input.segments, input.teamSize)
    if (problem) throw new AppError(problem, 'conflict')
    const id = uid()
    this.s.events.push({
      id, publicCode: code, name: input.name.trim(), courseId: input.courseId, date: input.date, timezone: input.timezone,
      description: input.description, status: 'draft', tiebreakPolicy: input.tiebreak, createdAt: nowIso(),
      registration: { ...NO_REGISTRATION }, teamSize: input.teamSize, cumulative: true, isTemplate: false,
    })
    this.s.rounds.push({ id: uid(), eventId: id, roundNumber: 1, date: input.date, teeId: input.teeId, segments: input.segments, useFlights: true, startType: input.startType, status: 'open' })
    this.s.staff.push({ id: uid(), eventId: id, email: DEMO_USER.email, role: 'admin', userId: DEMO_USER.id, groupIds: [] })
    this.log(id, 'event_created', input.name)
    this.commit()
    return id
  }

  async loadBundle(eventId: string): Promise<EventBundle> {
    const event = this.event(eventId)
    const access = await this.access(eventId)
    if (event.status === 'draft' && !access.role) throw new AppError('This event is not published yet.', 'not_found')
    const rounds = this.s.rounds.filter((r) => r.eventId === eventId).sort((a, b) => a.roundNumber - b.roundNumber)
    const roundIds = new Set(rounds.map((r) => r.id))
    const course = this.s.courses.find((c) => c.id === event.courseId)
    const tees = this.s.tees.filter((t) => t.courseId === event.courseId)
    const teeIds = new Set(tees.map((t) => t.id))
    return clone({
      event,
      course: course ? { id: course.id, name: course.name, city: course.city } : null,
      tees,
      holes: this.s.holes.filter((h) => teeIds.has(h.teeId)).sort((a, b) => a.number - b.number),
      rounds,
      flights: this.s.flights.filter((f) => f.eventId === eventId).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
      players: this.s.players.filter((p) => p.eventId === eventId),
      teams: this.s.teams.filter((t) => t.eventId === eventId),
      entries: this.s.entries.filter((e) => e.eventId === eventId),
      groups: this.s.groups.filter((g) => roundIds.has(g.roundId)),
      scores: this.s.scores.filter((s) => roundIds.has(s.roundId)),
    })
  }

  async updateEvent(eventId: string, patch: EventPatch) {
    this.requireAdmin(eventId)
    const ev = this.event(eventId)
    if (patch.isTemplate && ev.status !== 'draft') throw new AppError('Only a draft can be a template.', 'conflict')
    if (patch.teamSize !== undefined && patch.teamSize !== ev.teamSize) this.changeTeamSize(eventId, patch.teamSize)
    Object.assign(ev, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)))
    this.commit()
  }

  private hasScores(eventId: string) {
    const rounds = new Set(this.s.rounds.filter((r) => r.eventId === eventId).map((r) => r.id))
    return this.s.scores.some((s) => rounds.has(s.roundId))
  }
  private newEntry(eventId: string, kind: 'player' | 'team', id: string): Entry {
    return { id: uid(), eventId, kind, playerId: kind === 'player' ? id : null, teamId: kind === 'team' ? id : null, status: 'active', statusNote: '', flightId: null }
  }
  private changeTeamSize(eventId: string, size: number) {
    if (this.hasScores(eventId)) throw new AppError("The team size can't change after scores have been entered.", 'conflict')
    if (size > 1 && this.s.teams.some((t) => t.eventId === eventId && t.playerIds.length > size))
      throw new AppError(`Some teams have more than ${size} players. Change those teams first.`, 'conflict')
    for (const r of this.s.rounds.filter((x) => x.eventId === eventId)) if (segmentsProblem(r.segments, size)) r.segments = defaultSegments(size)
    const removed = new Set(this.s.entries.filter((e) => e.eventId === eventId).map((e) => e.id))
    this.s.entries = this.s.entries.filter((e) => !removed.has(e.id))
    this.s.groups.forEach((g) => (g.entryIds = g.entryIds.filter((id) => !removed.has(id))))
    if (size === 1) for (const p of this.s.players.filter((x) => x.eventId === eventId)) this.s.entries.push(this.newEntry(eventId, 'player', p.id))
    else for (const t of this.s.teams.filter((x) => x.eventId === eventId)) this.s.entries.push(this.newEntry(eventId, 'team', t.id))
  }

  async updateRegistrationSettings(eventId: string, r: RegistrationSettings) {
    this.requireAdmin(eventId)
    if (r.maxPlayers !== null && (!Number.isInteger(r.maxPlayers) || r.maxPlayers < 1 || r.maxPlayers > 500))
      throw new AppError('Field limit must be 1–500 players, or blank for no limit.', 'invalid')
    this.event(eventId).registration = { ...r }
    this.commit()
  }

  async updateRound(roundId: string, patch: RoundPatch) {
    const round = this.s.rounds.find((r) => r.id === roundId)
    if (!round) throw new AppError('Round not found.', 'not_found')
    this.requireAdmin(round.eventId)
    if (patch.segments) {
      const problem = segmentsProblem(patch.segments, this.event(round.eventId).teamSize)
      if (problem) throw new AppError(problem, 'conflict')
      if (JSON.stringify(patch.segments) !== JSON.stringify(round.segments) && this.s.scores.some((s) => s.roundId === roundId))
        throw new AppError("The format can't change after scores have been entered.", 'conflict')
    }
    Object.assign(round, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)))
    this.commit()
  }
  async addRound(eventId: string) {
    this.requireAdmin(eventId)
    const rounds = this.s.rounds.filter((r) => r.eventId === eventId).sort((a, b) => a.roundNumber - b.roundNumber)
    const last = rounds[rounds.length - 1]!
    if (last.roundNumber >= 6) throw new AppError('An event can have at most 6 rounds.', 'conflict')
    const d = new Date(`${last.date}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 1)
    const id = uid()
    this.s.rounds.push({ ...clone(last), id, roundNumber: last.roundNumber + 1, date: d.toISOString().slice(0, 10), status: 'open' })
    this.log(eventId, 'round_added', `Round ${last.roundNumber + 1}`)
    this.commit()
    return id
  }
  async deleteRound(roundId: string) {
    const r = this.s.rounds.find((x) => x.id === roundId)
    if (!r) return
    this.requireAdmin(r.eventId)
    const rest = this.s.rounds.filter((x) => x.eventId === r.eventId && x.id !== roundId)
    if (!rest.length) throw new AppError('An event needs at least one round.', 'conflict')
    if (this.s.scores.some((s) => s.roundId === roundId)) throw new AppError("This round has scores and can't be removed.", 'conflict')
    const groups = new Set(this.s.groups.filter((g) => g.roundId === roundId).map((g) => g.id))
    this.s.groups = this.s.groups.filter((g) => !groups.has(g.id))
    this.s.rounds = this.s.rounds.filter((x) => x.id !== roundId)
    rest.sort((a, b) => a.roundNumber - b.roundNumber).forEach((x, i) => (x.roundNumber = i + 1))
    this.log(r.eventId, 'round_removed', `Round ${r.roundNumber}`)
    this.commit()
  }
  async duplicateEvent(eventId: string, name: string, date: string, asTemplate: boolean) {
    this.requireAdmin(eventId)
    if (!name.trim() || !date) throw new AppError('Give the new event a name and a date.', 'invalid')
    const src = this.event(eventId)
    const shiftDays = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${src.date}T12:00:00Z`)) / 864e5)
    const shift = (iso: string) => {
      const d = new Date(`${iso}T12:00:00Z`)
      d.setUTCDate(d.getUTCDate() + shiftDays)
      return d.toISOString().slice(0, 10)
    }
    let code: string
    do code = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('')
    while (this.s.events.some((e) => e.publicCode === code))
    const id = uid()
    const closes = src.registration.closesAt ? new Date(Date.parse(src.registration.closesAt) + shiftDays * 864e5).toISOString() : null
    this.s.events.push({
      ...clone(src), id, publicCode: code, name: name.trim(), date, status: 'draft', createdAt: nowIso(), isTemplate: asTemplate,
      registration: { ...src.registration, open: false, closesAt: closes },
    })
    for (const r of this.s.rounds.filter((x) => x.eventId === eventId))
      this.s.rounds.push({ ...clone(r), id: uid(), eventId: id, date: shift(r.date), status: 'open' })
    for (const f of this.s.flights.filter((x) => x.eventId === eventId)) this.s.flights.push({ ...f, id: uid(), eventId: id })
    this.s.staff.push({ id: uid(), eventId: id, email: DEMO_USER.email, role: 'admin', userId: DEMO_USER.id, groupIds: [] })
    this.log(id, 'event_created', `Copied from ${src.name}`)
    this.commit()
    return id
  }

  // ── Flights ──
  async createFlight(eventId: string, name: string, sortOrder: number) {
    this.requireAdmin(eventId)
    if (!name.trim()) throw new AppError('Flight name is required.', 'invalid')
    if (this.s.flights.some((f) => f.eventId === eventId && f.name.toLowerCase() === name.trim().toLowerCase()))
      throw new AppError('That flight already exists.', 'conflict')
    const id = uid()
    this.s.flights.push({ id, eventId, name: name.trim(), sortOrder })
    this.commit()
    return id
  }
  async updateFlight(flightId: string, name: string, sortOrder: number) {
    const f = this.s.flights.find((x) => x.id === flightId)
    if (!f) throw new AppError('Flight not found.', 'not_found')
    this.requireAdmin(f.eventId)
    f.name = name.trim() || f.name
    f.sortOrder = sortOrder
    this.commit()
  }
  async deleteFlight(flightId: string) {
    const f = this.s.flights.find((x) => x.id === flightId)
    if (!f) return
    this.requireAdmin(f.eventId)
    this.s.flights = this.s.flights.filter((x) => x.id !== flightId)
    this.s.entries.forEach((e) => e.flightId === flightId && (e.flightId = null))
    this.commit()
  }
  async setEntryFlights(eventId: string, assignments: { entryId: string; flightId: string | null }[]) {
    this.requireAdmin(eventId)
    if (this.event(eventId).status === 'finalized') throw new AppError('Results are final. Reopen a round first.', 'conflict')
    for (const a of assignments) {
      if (a.flightId && !this.s.flights.some((f) => f.id === a.flightId && f.eventId === eventId)) throw new AppError('Unknown flight.', 'conflict')
      const e = this.s.entries.find((x) => x.id === a.entryId && x.eventId === eventId)
      if (e) e.flightId = a.flightId
    }
    this.log(eventId, 'flights_assigned', `${assignments.length} entries`)
    this.commit()
  }

  async deleteEvent(eventId: string) {
    this.requireAdmin(eventId)
    if (this.event(eventId).status !== 'draft') throw new AppError('Only draft events can be deleted.', 'conflict')
    const roundIds = new Set(this.s.rounds.filter((r) => r.eventId === eventId).map((r) => r.id))
    this.s.events = this.s.events.filter((e) => e.id !== eventId)
    this.s.rounds = this.s.rounds.filter((r) => r.eventId !== eventId)
    this.s.players = this.s.players.filter((x) => x.eventId !== eventId)
    this.s.teams = this.s.teams.filter((x) => x.eventId !== eventId)
    this.s.entries = this.s.entries.filter((x) => x.eventId !== eventId)
    this.s.groups = this.s.groups.filter((x) => !roundIds.has(x.roundId))
    this.s.flights = this.s.flights.filter((x) => x.eventId !== eventId)
    this.s.staff = this.s.staff.filter((x) => x.eventId !== eventId)
    this.commit()
  }

  // ── Roster ──
  private teamSize(eventId: string) {
    return this.event(eventId).teamSize
  }

  async addPlayer(eventId: string, p: PlayerInput) {
    this.requireAdmin(eventId)
    if (!p.firstName.trim() || !p.lastName.trim()) throw new AppError('First and last name are required.', 'invalid')
    const id = uid()
    this.s.players.push({ id, eventId, firstName: p.firstName.trim(), lastName: p.lastName.trim(), teeId: null })
    this.s.contacts.push({ playerId: id, email: p.email.trim(), phone: p.phone.trim() })
    if (this.teamSize(eventId) === 1) this.s.entries.push(this.newEntry(eventId, 'player', id))
    this.commit()
    return id
  }
  async updatePlayer(playerId: string, eventId: string, p: PlayerInput) {
    this.requireAdmin(eventId)
    const pl = this.s.players.find((x) => x.id === playerId)
    if (!pl) throw new AppError('Player not found.', 'not_found')
    if (!p.firstName.trim() || !p.lastName.trim()) throw new AppError('First and last name are required.', 'invalid')
    pl.firstName = p.firstName.trim()
    pl.lastName = p.lastName.trim()
    const c = this.s.contacts.find((x) => x.playerId === playerId)
    if (c) Object.assign(c, { email: p.email.trim(), phone: p.phone.trim() })
    else this.s.contacts.push({ playerId, email: p.email.trim(), phone: p.phone.trim() })
    this.commit()
  }
  async removePlayer(playerId: string) {
    const pl = this.s.players.find((x) => x.id === playerId)
    if (!pl) return
    this.requireAdmin(pl.eventId)
    const ownEntry = this.s.entries.find((e) => e.playerId === playerId)
    if (ownEntry && this.s.scores.some((s) => s.entryId === ownEntry.id))
      throw new AppError('This player has scores. Mark the entry WD instead of deleting it.', 'conflict')
    this.s.players = this.s.players.filter((x) => x.id !== playerId)
    this.s.contacts = this.s.contacts.filter((x) => x.playerId !== playerId)
    this.s.teams.forEach((t) => (t.playerIds = t.playerIds.filter((id) => id !== playerId)))
    const own = this.s.entries.filter((e) => e.playerId === playerId).map((e) => e.id)
    this.s.entries = this.s.entries.filter((e) => !own.includes(e.id))
    this.s.groups.forEach((g) => (g.entryIds = g.entryIds.filter((id) => !own.includes(id))))
    this.commit()
  }
  async setPlayerTee(playerId: string, teeId: string | null) {
    const pl = this.s.players.find((x) => x.id === playerId)
    if (!pl) throw new AppError('Player not found.', 'not_found')
    this.requireAdmin(pl.eventId)
    if (teeId && !this.s.tees.some((t) => t.id === teeId && t.courseId === this.event(pl.eventId).courseId))
      throw new AppError("That tee isn't on this event's course.", 'conflict')
    pl.teeId = teeId
    this.commit()
  }
  async listContacts(eventId: string) {
    if (!this.isAdmin(eventId)) return []
    const ids = new Set(this.s.players.filter((p) => p.eventId === eventId).map((p) => p.id))
    return clone(this.s.contacts.filter((c) => ids.has(c.playerId)))
  }
  private checkTeamMembers(eventId: string, teamId: string | null, playerIds: string[]) {
    const size = this.teamSize(eventId)
    if (playerIds.length > size) throw new AppError(`A team in this event can have at most ${size} players.`, 'invalid')
    if (new Set(playerIds).size !== playerIds.length) throw new AppError('Pick different players.', 'invalid')
    for (const pid of playerIds) {
      const other = this.s.teams.find((t) => t.eventId === eventId && t.id !== teamId && t.playerIds.includes(pid))
      if (other) throw new AppError(`That player is already on ${other.name}.`, 'conflict')
    }
  }
  async createTeam(eventId: string, name: string, playerIds: string[]) {
    this.requireAdmin(eventId)
    if (!name.trim()) throw new AppError('Team name is required.', 'invalid')
    if (this.s.teams.some((t) => t.eventId === eventId && t.name.toLowerCase() === name.trim().toLowerCase()))
      throw new AppError('A team with that name already exists.', 'conflict')
    this.checkTeamMembers(eventId, null, playerIds)
    const id = uid()
    this.s.teams.push({ id, eventId, name: name.trim(), playerIds })
    if (this.teamSize(eventId) > 1) this.s.entries.push(this.newEntry(eventId, 'team', id))
    this.commit()
    return id
  }
  async updateTeam(teamId: string, eventId: string, name: string, playerIds: string[]) {
    this.requireAdmin(eventId)
    const t = this.s.teams.find((x) => x.id === teamId)
    if (!t) throw new AppError('Team not found.', 'not_found')
    this.checkTeamMembers(eventId, teamId, playerIds)
    t.name = name.trim() || t.name
    t.playerIds = playerIds
    this.commit()
  }
  async deleteTeam(teamId: string) {
    const t = this.s.teams.find((x) => x.id === teamId)
    if (!t) return
    this.requireAdmin(t.eventId)
    const entry = this.s.entries.find((e) => e.teamId === teamId)
    if (entry && this.s.scores.some((s) => s.entryId === entry.id))
      throw new AppError('This team has scores. Mark the entry WD instead of deleting it.', 'conflict')
    this.s.teams = this.s.teams.filter((x) => x.id !== teamId)
    if (entry) {
      this.s.entries = this.s.entries.filter((e) => e.id !== entry.id)
      this.s.groups.forEach((g) => (g.entryIds = g.entryIds.filter((id) => id !== entry.id)))
    }
    this.commit()
  }
  async setEntryStatus(entryId: string, status: EntryStatus, note: string) {
    const e = this.s.entries.find((x) => x.id === entryId)
    if (!e) throw new AppError('Entry not found.', 'not_found')
    this.requireAdmin(e.eventId)
    if (this.event(e.eventId).status === 'finalized') throw new AppError('Results are final. Reopen a round first.', 'conflict')
    this.log(e.eventId, `entry_status:${e.status}->${status}`, `${entryId} ${note}`.trim())
    e.status = status
    e.statusNote = note
    this.commit()
  }

  // ── Registration ──
  private makeRef(eventId: string) {
    let ref: string
    do ref = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('')
    while (this.s.registrations.some((r) => r.eventId === eventId && r.ref === ref))
    return ref
  }
  private confirmInternal(reg: Registration) {
    const teamEvent = this.teamSize(reg.eventId) > 1
    const ids: string[] = []
    for (const person of reg.people) {
      const id = uid()
      this.s.players.push({ id, eventId: reg.eventId, firstName: person.firstName, lastName: person.lastName, teeId: null })
      this.s.contacts.push({ playerId: id, email: person.email, phone: person.phone })
      if (person.handicapIndex !== null)
        this.s.handicaps.push({
          playerId: id, handicapIndex: person.handicapIndex,
          source: reg.source === 'online' ? 'Self-reported at registration' : 'Entered by admin', asOf: reg.createdAt.slice(0, 10),
        })
      if (!teamEvent) this.s.entries.push(this.newEntry(reg.eventId, 'player', id))
      person.playerId = id
      ids.push(id)
    }
    if (teamEvent) {
      const base = reg.teamName.trim() || reg.people.map((x) => x.lastName).join(' / ')
      let name = base
      let n = 1
      while (this.s.teams.some((t) => t.eventId === reg.eventId && t.name.toLowerCase() === name.toLowerCase())) name = `${base.slice(0, 54)} (${++n})`
      const teamId = uid()
      this.s.teams.push({ id: teamId, eventId: reg.eventId, name, playerIds: ids })
      this.s.entries.push(this.newEntry(reg.eventId, 'team', teamId))
      reg.teamId = teamId
    }
    reg.status = 'confirmed'
  }

  async register(code: string, people: RegistrantInput[], teamName: string, note: string): Promise<RegisterResult> {
    const ev = this.s.events.find((e) => e.publicCode === code.trim().toUpperCase())
    if (!ev || (ev.status !== 'published' && ev.status !== 'in_progress')) throw new AppError('This event is not open for registration.', 'not_found')
    const r = ev.registration
    if (!r.open) throw new AppError('Registration for this event is closed.', 'conflict')
    if (r.closesAt && Date.now() >= Date.parse(r.closesAt)) throw new AppError('Registration for this event has closed.', 'conflict')
    const size = ev.teamSize
    if (people.length !== size) throw new AppError(size === 1 ? 'Register one player at a time.' : `This is a ${size}-person team event. Enter all ${size} players.`, 'invalid')
    const emails: string[] = []
    people.forEach((x, i) => {
      if (!x.firstName.trim() || !x.lastName.trim()) throw new AppError(`Player ${i + 1}: first and last name are required.`, 'invalid')
      const em = x.email.trim().toLowerCase()
      if (i === 0 && !em) throw new AppError('An email address is required so the organizer can reach you.', 'invalid')
      if (em) {
        if (emails.includes(em)) throw new AppError('Each player needs a different email address.', 'invalid')
        emails.push(em)
        if (this.s.registrations.some((g) => g.eventId === ev.id && g.status !== 'cancelled' && g.people.some((p) => p.email.toLowerCase() === em)))
          throw new AppError(`${em} is already registered for this event. Contact the organizer to make changes.`, 'conflict')
      }
    })
    const count = this.s.players.filter((p) => p.eventId === ev.id).length
    const full = r.maxPlayers !== null && count + size > r.maxPlayers
    const reg: Registration = {
      id: uid(), eventId: ev.id, ref: this.makeRef(ev.id), status: 'waitlisted', teamName: teamName.trim().slice(0, 60), teamId: null,
      registrantNote: note.trim().slice(0, 500), paymentStatus: 'unpaid', paymentMethod: '', amountPaidCents: null, adminNote: '',
      source: 'online', createdAt: nowIso(),
      people: people.map((x, i) => ({
        position: i + 1, firstName: x.firstName.trim(), lastName: x.lastName.trim(), email: x.email.trim().toLowerCase(), phone: x.phone.trim(),
        handicapIndex: x.handicapIndex.trim() === '' ? null : Number(x.handicapIndex), playerId: null,
      })),
    }
    this.s.registrations.push(reg)
    if (!full) this.confirmInternal(reg)
    this.log(ev.id, `registration_${reg.status}`, reg.ref)
    this.commit()
    return { status: reg.status === 'confirmed' ? 'confirmed' : 'waitlisted', ref: reg.ref, teamName: reg.teamId ? this.s.teams.find((t) => t.id === reg.teamId)!.name : null }
  }
  async listRegistrations(eventId: string) {
    if (!this.isAdmin(eventId)) return []
    return clone(this.s.registrations.filter((r) => r.eventId === eventId))
  }
  private reg(regId: string) {
    const r = this.s.registrations.find((x) => x.id === regId)
    if (!r) throw new AppError('Registration not found.', 'not_found')
    this.requireAdmin(r.eventId)
    return r
  }
  async updateRegistrationPayment(regId: string, p: { paymentStatus: PaymentStatus; paymentMethod: PaymentMethod; amountPaidCents: number | null; adminNote: string }) {
    const r = this.reg(regId)
    Object.assign(r, p)
    this.commit()
  }
  async promoteRegistration(regId: string) {
    const r = this.reg(regId)
    if (r.status !== 'waitlisted') throw new AppError('Only waitlisted registrations can be confirmed.', 'conflict')
    this.confirmInternal(r)
    this.log(r.eventId, 'registration_promoted', r.ref)
    this.commit()
  }
  async cancelRegistration(regId: string, reason: string) {
    const r = this.reg(regId)
    if (r.status === 'cancelled') return
    const playerIds = r.people.map((p) => p.playerId).filter((x): x is string => !!x)
    const entryIds = this.s.entries.filter((e) => (e.playerId && playerIds.includes(e.playerId)) || (r.teamId && e.teamId === r.teamId)).map((e) => e.id)
    if (this.s.scores.some((s) => entryIds.includes(s.entryId))) throw new AppError('This registration has scores. Mark the entry WD instead of cancelling.', 'conflict')
    this.s.entries = this.s.entries.filter((e) => !entryIds.includes(e.id))
    this.s.groups.forEach((g) => (g.entryIds = g.entryIds.filter((id) => !entryIds.includes(id))))
    this.s.teams = this.s.teams.filter((t) => t.id !== r.teamId)
    this.s.players = this.s.players.filter((p) => !playerIds.includes(p.id))
    this.s.contacts = this.s.contacts.filter((c) => !playerIds.includes(c.playerId))
    this.s.handicaps = this.s.handicaps.filter((h) => !playerIds.includes(h.playerId))
    r.people.forEach((p) => (p.playerId = null))
    r.status = 'cancelled'
    r.teamId = null
    this.log(r.eventId, 'registration_cancelled', `${r.ref} ${reason}`.trim())
    this.commit()
  }
  async listHandicaps(eventId: string) {
    if (!this.isAdmin(eventId)) return []
    const ids = new Set(this.s.players.filter((p) => p.eventId === eventId).map((p) => p.id))
    return clone(this.s.handicaps.filter((h) => ids.has(h.playerId)))
  }
  async setPlayerHandicap(playerId: string, index: number | null, source: string, asOf: string) {
    const pl = this.s.players.find((p) => p.id === playerId)
    if (!pl) throw new AppError('Player not found.', 'not_found')
    this.requireAdmin(pl.eventId)
    this.s.handicaps = this.s.handicaps.filter((h) => h.playerId !== playerId)
    if (index !== null) {
      if (!source.trim()) throw new AppError('Say where this handicap came from.', 'invalid')
      this.s.handicaps.push({ playerId, handicapIndex: Math.round(index * 10) / 10, source: source.trim(), asOf: asOf || nowIso().slice(0, 10) })
    }
    this.commit()
  }

  // ── Groups ──
  private groupEvent(groupId: string) {
    const g = this.s.groups.find((x) => x.id === groupId)
    if (!g) throw new AppError('Group not found.', 'not_found')
    const r = this.s.rounds.find((x) => x.id === g.roundId)!
    return { g, eventId: r.eventId }
  }
  async createGroup(roundId: string, eventId: string, g: GroupInput) {
    this.requireAdmin(eventId)
    if (!g.name.trim()) throw new AppError('Group name is required.', 'invalid')
    if (this.s.groups.some((x) => x.roundId === roundId && x.name.toLowerCase() === g.name.trim().toLowerCase()))
      throw new AppError('A group with that name already exists.', 'conflict')
    const id = uid()
    this.s.groups.push({ id, roundId, name: g.name.trim(), teeTime: g.teeTime, startingHole: g.startingHole, entryIds: [] })
    this.commit()
    return id
  }
  async updateGroup(groupId: string, g: GroupInput) {
    const { g: grp, eventId } = this.groupEvent(groupId)
    this.requireAdmin(eventId)
    Object.assign(grp, { name: g.name.trim() || grp.name, teeTime: g.teeTime, startingHole: g.startingHole })
    this.commit()
  }
  async deleteGroup(groupId: string) {
    const { eventId } = this.groupEvent(groupId)
    this.requireAdmin(eventId)
    this.s.groups = this.s.groups.filter((x) => x.id !== groupId)
    this.s.staff.forEach((st) => (st.groupIds = st.groupIds.filter((id) => id !== groupId)))
    this.commit()
  }
  async assignEntry(roundId: string, eventId: string, entryId: string, groupId: string | null) {
    this.requireAdmin(eventId)
    this.s.groups.filter((g) => g.roundId === roundId).forEach((g) => (g.entryIds = g.entryIds.filter((id) => id !== entryId)))
    if (groupId) {
      const g = this.s.groups.find((x) => x.id === groupId && x.roundId === roundId)
      if (!g) throw new AppError('Group not found.', 'not_found')
      g.entryIds.push(entryId)
    }
    this.commit()
  }

  // ── Staff ──
  async listStaff(eventId: string) {
    if (!this.isAdmin(eventId)) return []
    return clone(this.s.staff.filter((x) => x.eventId === eventId))
  }
  async inviteStaff(eventId: string, email: string, role: StaffRole) {
    this.requireAdmin(eventId)
    const e = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new AppError('Enter a valid email address.', 'invalid')
    if (this.s.staff.some((x) => x.eventId === eventId && x.email === e)) throw new AppError('That person is already on the staff list.', 'conflict')
    this.s.staff.push({ id: uid(), eventId, email: e, role, userId: null, groupIds: [] })
    this.commit()
  }
  async removeStaff(staffId: string) {
    const st = this.s.staff.find((x) => x.id === staffId)
    if (!st) return
    this.requireAdmin(st.eventId)
    if (st.role === 'admin' && st.userId === DEMO_USER.id) throw new AppError("You can't remove yourself as admin.", 'conflict')
    this.s.staff = this.s.staff.filter((x) => x.id !== staffId)
    this.commit()
  }
  async setStaffGroups(staffId: string, eventId: string, groupIds: string[]) {
    this.requireAdmin(eventId)
    const st = this.s.staff.find((x) => x.id === staffId)
    if (!st) throw new AppError('Staff member not found.', 'not_found')
    st.groupIds = [...groupIds]
    this.commit()
  }

  // ── Status ──
  async startBlockers(eventId: string) {
    const ev = this.event(eventId)
    const rounds = this.s.rounds.filter((r) => r.eventId === eventId).sort((a, b) => a.roundNumber - b.roundNumber)
    const problems: string[] = []
    let min = 2
    for (const round of rounds) {
      if (!round.teeId) problems.push(`Choose a tee for round ${round.roundNumber}.`)
      else {
        const n = this.s.holes.filter((h) => h.teeId === round.teeId).length
        if (n !== 18) problems.push(`Round ${round.roundNumber}'s tee has ${n} of 18 holes set up.`)
      }
      for (const sg of round.segments) if (sg.method === 'best_ball') min = Math.max(min, sg.count)
    }
    if (this.s.players.some((p) => p.eventId === eventId && p.teeId && this.s.holes.filter((h) => h.teeId === p.teeId).length !== 18))
      problems.push("A player's tee doesn't have all 18 holes set up.")
    if (!this.s.entries.some((e) => e.eventId === eventId)) problems.push(ev.teamSize === 1 ? 'Add at least one player.' : 'Add at least one team.')
    if (ev.teamSize > 1 && this.s.teams.some((t) => t.eventId === eventId && t.playerIds.length < min))
      problems.push(`Every team needs at least ${min} players.`)
    return problems
  }
  async setEventStatus(eventId: string, status: EventStatus, reason: string) {
    this.requireAdmin(eventId)
    const ev = this.event(eventId)
    const from = ev.status
    if (from === status) return
    if (ev.isTemplate) throw new AppError("This is a template. Create this year's event from it, then publish that.", 'conflict')
    const ok =
      (from === 'draft' && status === 'published') ||
      (from === 'published' && (status === 'draft' || status === 'in_progress')) ||
      (from === 'in_progress' && status === 'published')
    if (!ok) throw new AppError(`Can't change status from ${from} to ${status}.`, 'conflict')
    if (status === 'in_progress') {
      const b = await this.startBlockers(eventId)
      if (b.length) throw new AppError(`Not ready to start: ${b.join(' ')}`, 'conflict')
    }
    if (from === 'in_progress' && !reason.trim()) throw new AppError('Give a reason for pausing scoring.', 'invalid')
    ev.status = status
    this.log(eventId, `status:${from}->${status}`, reason)
    this.commit()
  }
  async setRoundLock(roundId: string, locked: boolean, reason: string) {
    const r = this.s.rounds.find((x) => x.id === roundId)!
    this.requireAdmin(r.eventId)
    if (r.status === 'finalized') throw new AppError('The round is final. Reopen it first.', 'conflict')
    r.status = locked ? 'locked' : 'open'
    this.log(r.eventId, locked ? 'round_locked' : 'round_unlocked', reason)
    this.commit()
  }
  async finalizeRound(roundId: string, reason: string) {
    const r = this.s.rounds.find((x) => x.id === roundId)!
    this.requireAdmin(r.eventId)
    if (r.status === 'finalized') return
    if (this.event(r.eventId).status !== 'in_progress') throw new AppError('Start the event before finalizing.', 'conflict')
    const incomplete = this.s.entries.filter((e) => e.eventId === r.eventId && e.status === 'active' && this.holesDone(r.id, e.id) < 18).length
    if (incomplete) throw new AppError(`${incomplete} active ${incomplete === 1 ? 'entry is' : 'entries are'} not complete. Finish their cards or mark them WD, DNF or NS.`, 'conflict')
    r.status = 'finalized'
    if (this.s.rounds.every((x) => x.eventId !== r.eventId || x.status === 'finalized')) this.event(r.eventId).status = 'finalized'
    this.log(r.eventId, 'finalized', `Round ${r.roundNumber}${reason.trim() ? `. ${reason.trim()}` : ''}`)
    this.commit()
  }
  async reopenRound(roundId: string, reason: string) {
    const r = this.s.rounds.find((x) => x.id === roundId)!
    this.requireAdmin(r.eventId)
    if (r.status !== 'finalized') throw new AppError("The round isn't final.", 'conflict')
    if (!reason.trim()) throw new AppError('A reason is required to reopen final results.', 'invalid')
    r.status = 'locked'
    this.event(r.eventId).status = 'in_progress'
    this.log(r.eventId, 'reopened', `Round ${r.roundNumber}. ${reason}`)
    this.commit()
  }

  // ── Scores ──
  private assertCanWrite(roundId: string, entryId: string, reason: string) {
    const r = this.s.rounds.find((x) => x.id === roundId)
    if (!r) throw new AppError('Round not found.', 'not_found')
    const entry = this.s.entries.find((e) => e.id === entryId && e.eventId === r.eventId)
    if (!entry) throw new AppError('That entry is not in this event.', 'not_found')
    const ev = this.event(r.eventId)
    const admin = this.isAdmin(r.eventId)
    if (!admin) {
      if (this.s.role !== 'scorekeeper') throw new AppError('Sign in to enter scores.', 'auth')
      const groups = this.scorekeeperGroups(r.eventId)
      if (!this.s.groups.some((g) => groups.includes(g.id) && g.entryIds.includes(entryId)))
        throw new AppError('You are not assigned to score this group.', 'forbidden')
    }
    if (r.status === 'finalized' || ev.status === 'finalized')
      throw new AppError('Results are final. An admin must reopen the round to make changes.', 'conflict')
    if (admin) {
      if (ev.status === 'draft') throw new AppError('Publish the event first.', 'conflict')
      if (r.status === 'locked' && !reason.trim()) throw new AppError('The round is locked. Give a reason for this correction.', 'conflict')
    } else {
      if (ev.status !== 'in_progress') throw new AppError('Scoring is not open for this event.', 'conflict')
      if (r.status === 'locked') throw new AppError('The round is locked.', 'conflict')
      if (entry.status !== 'active') throw new AppError(`This entry is marked ${entry.status.toUpperCase()}; only an admin can change its scores.`, 'conflict')
    }
  }
  private holesDone(roundId: string, entryId: string) {
    const r = this.s.rounds.find((x) => x.id === roundId)!
    let n = 0
    for (let h = 1; h <= 18; h++) {
      const seg = segmentFor(r.segments, h)
      const mine = this.s.scores.filter((s) => s.roundId === roundId && s.entryId === entryId && s.hole === h)
      if (seg.method === 'best_ball' ? mine.filter((s) => s.playerId).length >= seg.count : mine.some((s) => !s.playerId)) n++
    }
    return n
  }
  private assertSlot(slot: ScoreSlot) {
    if (!Number.isInteger(slot.hole) || slot.hole < 1 || slot.hole > 18) throw new AppError('Hole must be 1–18.', 'invalid')
    const r = this.s.rounds.find((x) => x.id === slot.roundId)!
    const entry = this.s.entries.find((e) => e.id === slot.entryId)!
    const method = segmentFor(r.segments, slot.hole).method
    if (method === 'best_ball') {
      if (!slot.playerId) throw new AppError(`Hole ${slot.hole} is best ball: enter each player's score.`, 'invalid')
      const team = this.s.teams.find((t) => t.id === entry.teamId)
      if (!team?.playerIds.includes(slot.playerId)) throw new AppError("That player isn't on this team.", 'conflict')
    } else if (slot.playerId) throw new AppError(`Hole ${slot.hole} takes one score for the ${entry.kind}.`, 'invalid')
  }
  private findScore(slot: ScoreSlot) {
    return this.s.scores.find((s) => s.roundId === slot.roundId && s.entryId === slot.entryId && s.hole === slot.hole && (s.playerId ?? null) === slot.playerId)
  }
  private audit(s: Score, action: 'insert' | 'update' | 'delete', oldStrokes: number | null, newStrokes: number | null, reason: string) {
    this.s.audit.push({
      id: uid(), roundId: s.roundId, entryId: s.entryId, playerId: s.playerId, hole: s.hole, action, oldStrokes, newStrokes, reason,
      changedBy: DEMO_USER.id, changedByLabel: `${DEMO_USER.email} (${this.s.role})`, changedAt: nowIso(),
    })
  }

  async setScore(slot: ScoreSlot, strokes: number, expectedVersion: number | null, reason: string) {
    this.assertCanWrite(slot.roundId, slot.entryId, reason)
    this.assertSlot(slot)
    if (!Number.isInteger(strokes) || strokes < 1 || strokes > 20) throw new AppError('A hole score must be between 1 and 20.', 'invalid')
    const cur = this.findScore(slot)
    if (!cur) {
      if (expectedVersion !== null) throw new AppError('This score was cleared by someone else.', 'conflict', null)
      const s: Score = { id: uid(), ...slot, strokes, version: 1, updatedAt: nowIso(), updatedBy: DEMO_USER.id }
      this.s.scores.push(s)
      this.audit(s, 'insert', null, strokes, reason)
      this.commit()
      return clone(s)
    }
    if (expectedVersion !== cur.version) throw new AppError('Someone else changed this hole.', 'conflict', clone(cur))
    if (cur.strokes === strokes) return clone(cur)
    const old = cur.strokes
    Object.assign(cur, { strokes, version: cur.version + 1, updatedAt: nowIso(), updatedBy: DEMO_USER.id })
    this.audit(cur, 'update', old, strokes, reason)
    this.commit()
    return clone(cur)
  }
  async clearScore(slot: ScoreSlot, expectedVersion: number, reason: string) {
    this.assertCanWrite(slot.roundId, slot.entryId, reason)
    const cur = this.findScore(slot)
    if (!cur) return
    if (expectedVersion !== cur.version) throw new AppError('Someone else changed this hole.', 'conflict', clone(cur))
    this.s.scores = this.s.scores.filter((s) => s.id !== cur.id)
    this.audit(cur, 'delete', cur.strokes, null, reason)
    this.commit()
  }
  async listScores(eventId: string) {
    const rounds = new Set(this.s.rounds.filter((r) => r.eventId === eventId).map((r) => r.id))
    return clone(this.s.scores.filter((s) => rounds.has(s.roundId)))
  }
  async listAudit(eventId: string) {
    if (!this.isAdmin(eventId)) return []
    const rounds = new Set(this.s.rounds.filter((r) => r.eventId === eventId).map((r) => r.id))
    return clone(this.s.audit.filter((a) => rounds.has(a.roundId))).reverse()
  }
  async listEventLog(eventId: string) {
    if (!this.isAdmin(eventId)) return []
    return clone(this.s.log.filter((l) => l.eventId === eventId)).reverse()
  }

  subscribe(_eventId: string, onChange: (what: 'scores' | 'all') => void) {
    const l = () => onChange('all')
    this.listeners.add(l)
    return () => void this.listeners.delete(l)
  }
}
