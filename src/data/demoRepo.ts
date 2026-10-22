// Demo mode: fictional data held in this browser's localStorage. Nothing is shared
// with anyone else. It enforces the same rules as the database (status, locking,
// group assignment, version conflicts) so the demo behaves like the real thing.
import type {
  EntryStatus,
  EventBundle,
  EventStatus,
  GolfEvent,
  Score,
  StaffRole,
} from '../domain/types'
import { validateHoleLayout, type HoleInput } from '../scoring/validation'
import { AppError } from './errors'
import { buildDemoState, DEMO_USER, type DemoState } from './demoSeed'
import type { Access, CourseDetail, GroupInput, NewEventInput, PlayerInput, Repo, SessionUser } from './repo'

const KEY = 'flagstick-demo-v1'
const CHANNEL = 'flagstick-demo'

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2))
const nowIso = () => new Date().toISOString()
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

function loadState(): DemoState {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw) as DemoState
      if (s.schema === 1) return s
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
    const round = this.s.rounds.find((r) => r.eventId === eventId)
    const first = this.s.groups.filter((g) => g.roundId === round?.id).sort((a, b) => a.name.localeCompare(b.name))[0]
    return first ? [first.id] : []
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
    const id = uid()
    this.s.events.push({
      id, publicCode: code, name: input.name.trim(), courseId: input.courseId, date: input.date, timezone: input.timezone,
      description: input.description, status: 'draft', tiebreakPolicy: input.tiebreak, createdAt: nowIso(),
    })
    this.s.rounds.push({ id: uid(), eventId: id, roundNumber: 1, date: input.date, teeId: input.teeId, format: input.format, startType: input.startType, status: 'open' })
    this.s.staff.push({ id: uid(), eventId: id, email: DEMO_USER.email, role: 'admin', userId: DEMO_USER.id, groupIds: [] })
    this.log(id, 'event_created', input.name)
    this.commit()
    return id
  }

  async loadBundle(eventId: string): Promise<EventBundle> {
    const event = this.event(eventId)
    const access = await this.access(eventId)
    if (event.status === 'draft' && !access.role) throw new AppError('This event is not published yet.', 'not_found')
    const round = this.s.rounds.find((r) => r.eventId === eventId)!
    const course = this.s.courses.find((c) => c.id === event.courseId)
    const tee = this.s.tees.find((t) => t.id === round.teeId) ?? null
    return clone({
      event,
      course: course ? { id: course.id, name: course.name, city: course.city } : null,
      tee,
      holes: this.s.holes.filter((h) => h.teeId === round.teeId).sort((a, b) => a.number - b.number),
      round,
      players: this.s.players.filter((p) => p.eventId === eventId),
      teams: this.s.teams.filter((t) => t.eventId === eventId),
      entries: this.s.entries.filter((e) => e.eventId === eventId),
      groups: this.s.groups.filter((g) => g.roundId === round.id),
      scores: this.s.scores.filter((s) => s.roundId === round.id),
    })
  }

  async updateEvent(eventId: string, patch: Partial<Pick<GolfEvent, 'name' | 'date' | 'timezone' | 'description' | 'tiebreakPolicy'>>) {
    this.requireAdmin(eventId)
    Object.assign(this.event(eventId), patch)
    if (patch.date) this.s.rounds.filter((r) => r.eventId === eventId).forEach((r) => (r.date = patch.date!))
    this.commit()
  }

  async updateRound(roundId: string, patch: { teeId?: string | null; format?: 'stroke_individual' | 'scramble_2'; startType?: 'tee_times' | 'shotgun' }) {
    const round = this.s.rounds.find((r) => r.id === roundId)
    if (!round) throw new AppError('Round not found.', 'not_found')
    this.requireAdmin(round.eventId)
    if (patch.format && patch.format !== round.format) {
      if (this.s.scores.some((s) => s.roundId === roundId)) throw new AppError("The format can't change after scores have been entered.", 'conflict')
      const removed = new Set(this.s.entries.filter((e) => e.eventId === round.eventId).map((e) => e.id))
      this.s.entries = this.s.entries.filter((e) => !removed.has(e.id))
      this.s.groups.forEach((g) => (g.entryIds = g.entryIds.filter((id) => !removed.has(id))))
      if (patch.format === 'stroke_individual')
        for (const p of this.s.players.filter((x) => x.eventId === round.eventId))
          this.s.entries.push({ id: uid(), eventId: round.eventId, kind: 'player', playerId: p.id, teamId: null, status: 'active', statusNote: '' })
      else
        for (const t of this.s.teams.filter((x) => x.eventId === round.eventId))
          this.s.entries.push({ id: uid(), eventId: round.eventId, kind: 'team', playerId: null, teamId: t.id, status: 'active', statusNote: '' })
    }
    Object.assign(round, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)))
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
    this.s.staff = this.s.staff.filter((x) => x.eventId !== eventId)
    this.commit()
  }

  // ── Roster ──
  private format(eventId: string) {
    return this.s.rounds.find((r) => r.eventId === eventId)!.format
  }

  async addPlayer(eventId: string, p: PlayerInput) {
    this.requireAdmin(eventId)
    if (!p.firstName.trim() || !p.lastName.trim()) throw new AppError('First and last name are required.', 'invalid')
    const id = uid()
    this.s.players.push({ id, eventId, firstName: p.firstName.trim(), lastName: p.lastName.trim() })
    this.s.contacts.push({ playerId: id, email: p.email.trim(), phone: p.phone.trim() })
    if (this.format(eventId) === 'stroke_individual')
      this.s.entries.push({ id: uid(), eventId, kind: 'player', playerId: id, teamId: null, status: 'active', statusNote: '' })
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
  async listContacts(eventId: string) {
    if (!this.isAdmin(eventId)) return []
    const ids = new Set(this.s.players.filter((p) => p.eventId === eventId).map((p) => p.id))
    return clone(this.s.contacts.filter((c) => ids.has(c.playerId)))
  }
  private checkTeamMembers(eventId: string, teamId: string | null, playerIds: string[]) {
    if (playerIds.length > 2) throw new AppError('A scramble team can have at most two players.', 'invalid')
    if (new Set(playerIds).size !== playerIds.length) throw new AppError('Pick two different players.', 'invalid')
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
    if (this.format(eventId) === 'scramble_2')
      this.s.entries.push({ id: uid(), eventId, kind: 'team', playerId: null, teamId: id, status: 'active', statusNote: '' })
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
    if (this.s.rounds.some((r) => r.eventId === e.eventId && r.status === 'finalized'))
      throw new AppError('Results are final. Reopen the round first.', 'conflict')
    this.log(e.eventId, `entry_status:${e.status}->${status}`, `${entryId} ${note}`.trim())
    e.status = status
    e.statusNote = note
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
    const round = this.s.rounds.find((r) => r.eventId === eventId)!
    const problems: string[] = []
    if (!round.teeId) problems.push('Choose a tee for the round.')
    else {
      const n = this.s.holes.filter((h) => h.teeId === round.teeId).length
      if (n !== 18) problems.push(`The tee has ${n} of 18 holes set up.`)
    }
    if (!this.s.entries.some((e) => e.eventId === eventId)) problems.push(`Add at least one ${round.format === 'scramble_2' ? 'team' : 'player'}.`)
    if (round.format === 'scramble_2' && this.s.teams.some((t) => t.eventId === eventId && t.playerIds.length !== 2))
      problems.push('Every scramble team needs exactly two players.')
    return problems
  }
  async setEventStatus(eventId: string, status: EventStatus, reason: string) {
    this.requireAdmin(eventId)
    const ev = this.event(eventId)
    const from = ev.status
    if (from === status) return
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
    const incomplete = this.s.entries.filter(
      (e) => e.eventId === r.eventId && e.status === 'active' && this.s.scores.filter((s) => s.roundId === roundId && s.entryId === e.id).length < 18,
    ).length
    if (incomplete) throw new AppError(`${incomplete} active ${incomplete === 1 ? 'entry is' : 'entries are'} not complete. Finish their cards or mark them WD/DQ.`, 'conflict')
    r.status = 'finalized'
    this.event(r.eventId).status = 'finalized'
    this.log(r.eventId, 'finalized', reason)
    this.commit()
  }
  async reopenRound(roundId: string, reason: string) {
    const r = this.s.rounds.find((x) => x.id === roundId)!
    this.requireAdmin(r.eventId)
    if (r.status !== 'finalized') throw new AppError("The round isn't final.", 'conflict')
    if (!reason.trim()) throw new AppError('A reason is required to reopen final results.', 'invalid')
    r.status = 'locked'
    this.event(r.eventId).status = 'in_progress'
    this.log(r.eventId, 'reopened', reason)
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
  private audit(s: Score, action: 'insert' | 'update' | 'delete', oldStrokes: number | null, newStrokes: number | null, reason: string) {
    this.s.audit.push({
      id: uid(), roundId: s.roundId, entryId: s.entryId, hole: s.hole, action, oldStrokes, newStrokes, reason,
      changedBy: DEMO_USER.id, changedByLabel: `${DEMO_USER.email} (${this.s.role})`, changedAt: nowIso(),
    })
  }

  async setScore(roundId: string, entryId: string, hole: number, strokes: number, expectedVersion: number | null, reason: string) {
    this.assertCanWrite(roundId, entryId, reason)
    if (!Number.isInteger(hole) || hole < 1 || hole > 18) throw new AppError('Hole must be 1–18.', 'invalid')
    if (!Number.isInteger(strokes) || strokes < 1 || strokes > 20) throw new AppError('A hole score must be between 1 and 20.', 'invalid')
    const cur = this.s.scores.find((s) => s.roundId === roundId && s.entryId === entryId && s.hole === hole)
    if (!cur) {
      if (expectedVersion !== null) throw new AppError('This score was cleared by someone else.', 'conflict', null)
      const s: Score = { id: uid(), roundId, entryId, hole, strokes, version: 1, updatedAt: nowIso(), updatedBy: DEMO_USER.id }
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
  async clearScore(roundId: string, entryId: string, hole: number, expectedVersion: number, reason: string) {
    this.assertCanWrite(roundId, entryId, reason)
    const cur = this.s.scores.find((s) => s.roundId === roundId && s.entryId === entryId && s.hole === hole)
    if (!cur) return
    if (expectedVersion !== cur.version) throw new AppError('Someone else changed this hole.', 'conflict', clone(cur))
    this.s.scores = this.s.scores.filter((s) => s.id !== cur.id)
    this.audit(cur, 'delete', cur.strokes, null, reason)
    this.commit()
  }
  async listScores(roundId: string) {
    return clone(this.s.scores.filter((s) => s.roundId === roundId))
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

  subscribe(_eventId: string, _roundId: string, onChange: (what: 'scores' | 'all') => void) {
    const l = () => onChange('all')
    this.listeners.add(l)
    return () => void this.listeners.delete(l)
  }
}
