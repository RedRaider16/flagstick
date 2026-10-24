// The app talks to data only through this interface. Two implementations:
//   DemoRepo     — fictional data in this browser only (no credentials, not shared)
//   SupabaseRepo — shared, persistent data; permissions enforced by the database
import type {
  Course,
  EntryStatus,
  EventBundle,
  EventLogEntry,
  EventStatus,
  GolfEvent,
  Group,
  Hole,
  PaymentMethod,
  PaymentStatus,
  Player,
  PlayerHandicap,
  RegisterResult,
  RegistrantInput,
  Registration,
  RegistrationSettings,
  PlayerContact,
  Round,
  Score,
  ScoreAudit,
  Segment,
  StaffMember,
  StaffRole,
  StartType,
  Tee,
  TiebreakPolicy,
} from '../domain/types'
import type { HoleInput } from '../scoring/validation'

export type Mode = 'demo' | 'live'

export interface SessionUser {
  id: string
  email: string
}

export interface Access {
  isOrganizer: boolean
  role: StaffRole | null
  /** Groups this user may score (scorekeepers). Admins may score everything. */
  groupIds: string[]
}

export interface CourseDetail {
  course: Course
  tees: Tee[]
  holes: Hole[]
}

export interface NewEventInput {
  name: string
  courseId: string
  teeId: string | null
  date: string
  timezone: string
  description: string
  teamSize: number
  segments: Segment[]
  startType: StartType
  tiebreak: TiebreakPolicy
}

/** One score cell: a team/individual score (playerId null) or a player's best-ball score. */
export interface ScoreSlot {
  roundId: string
  entryId: string
  playerId: string | null
  hole: number
}

export type EventPatch = Partial<Pick<GolfEvent, 'name' | 'date' | 'timezone' | 'description' | 'tiebreakPolicy' | 'teamSize' | 'cumulative' | 'isTemplate'>>
export type RoundPatch = Partial<Pick<Round, 'date' | 'teeId' | 'segments' | 'useFlights' | 'startType'>>

export interface PlayerInput {
  firstName: string
  lastName: string
  email: string
  phone: string
}

export interface GroupInput {
  name: string
  teeTime: string | null
  startingHole: number
}

export interface Repo {
  readonly mode: Mode

  // ── Session ──
  currentUser(): Promise<SessionUser | null>
  onAuthChange(cb: () => void): () => void
  requestSignIn(email: string): Promise<void>
  verifyCode(email: string, code: string): Promise<void>
  signOut(): Promise<void>

  // ── Discovery ──
  myEvents(): Promise<GolfEvent[]>
  findEventByCode(code: string): Promise<GolfEvent | null>
  access(eventId: string): Promise<Access>
  isOrganizer(): Promise<boolean>

  // ── Courses ──
  listCourses(): Promise<Course[]>
  courseDetail(courseId: string): Promise<CourseDetail>
  createCourse(name: string, city: string): Promise<string>
  createTee(courseId: string, name: string): Promise<string>
  saveHoles(teeId: string, holes: HoleInput[]): Promise<void>

  // ── Events ──
  createEvent(input: NewEventInput): Promise<string>
  loadBundle(eventId: string): Promise<EventBundle>
  updateEvent(eventId: string, patch: EventPatch): Promise<void>
  updateRegistrationSettings(eventId: string, s: RegistrationSettings): Promise<void>
  updateRound(roundId: string, patch: RoundPatch): Promise<void>
  addRound(eventId: string): Promise<string>
  deleteRound(roundId: string): Promise<void>
  deleteEvent(eventId: string): Promise<void>
  /** Copy the setup (rounds, formats, flights, fees; no players) into a new draft. */
  duplicateEvent(eventId: string, name: string, date: string, asTemplate: boolean): Promise<string>

  // ── Flights ──
  createFlight(eventId: string, name: string, sortOrder: number): Promise<string>
  updateFlight(flightId: string, name: string, sortOrder: number): Promise<void>
  deleteFlight(flightId: string): Promise<void>
  setEntryFlights(eventId: string, assignments: { entryId: string; flightId: string | null }[]): Promise<void>

  // ── Roster ──
  addPlayer(eventId: string, p: PlayerInput): Promise<string>
  updatePlayer(playerId: string, eventId: string, p: PlayerInput): Promise<void>
  removePlayer(playerId: string): Promise<void>
  setPlayerTee(playerId: string, teeId: string | null): Promise<void>
  listContacts(eventId: string): Promise<PlayerContact[]>
  createTeam(eventId: string, name: string, playerIds: string[]): Promise<string>
  updateTeam(teamId: string, eventId: string, name: string, playerIds: string[]): Promise<void>
  deleteTeam(teamId: string): Promise<void>
  setEntryStatus(entryId: string, status: EntryStatus, note: string): Promise<void>

  // ── Registration ──
  /** Public: sign up for an event by its code (no account needed). */
  register(code: string, people: RegistrantInput[], teamName: string, note: string): Promise<RegisterResult>
  listRegistrations(eventId: string): Promise<Registration[]>
  updateRegistrationPayment(regId: string, p: { paymentStatus: PaymentStatus; paymentMethod: PaymentMethod; amountPaidCents: number | null; adminNote: string }): Promise<void>
  promoteRegistration(regId: string): Promise<void>
  cancelRegistration(regId: string, reason: string): Promise<void>
  listHandicaps(eventId: string): Promise<PlayerHandicap[]>
  setPlayerHandicap(playerId: string, index: number | null, source: string, asOf: string): Promise<void>

  // ── Groups ──
  createGroup(roundId: string, eventId: string, g: GroupInput): Promise<string>
  updateGroup(groupId: string, g: GroupInput): Promise<void>
  deleteGroup(groupId: string): Promise<void>
  assignEntry(roundId: string, eventId: string, entryId: string, groupId: string | null): Promise<void>

  // ── Staff ──
  listStaff(eventId: string): Promise<StaffMember[]>
  inviteStaff(eventId: string, email: string, role: StaffRole): Promise<void>
  removeStaff(staffId: string): Promise<void>
  setStaffGroups(staffId: string, eventId: string, groupIds: string[]): Promise<void>

  // ── Status ──
  startBlockers(eventId: string): Promise<string[]>
  setEventStatus(eventId: string, status: EventStatus, reason: string): Promise<void>
  setRoundLock(roundId: string, locked: boolean, reason: string): Promise<void>
  finalizeRound(roundId: string, reason: string): Promise<void>
  reopenRound(roundId: string, reason: string): Promise<void>

  // ── Scores ──
  /** expectedVersion: version last seen, or null if the hole looked empty. Throws AppError('conflict'). */
  setScore(slot: ScoreSlot, strokes: number, expectedVersion: number | null, reason: string): Promise<Score>
  clearScore(slot: ScoreSlot, expectedVersion: number, reason: string): Promise<void>
  /** Every round's scores. */
  listScores(eventId: string): Promise<Score[]>
  listAudit(eventId: string): Promise<ScoreAudit[]>
  listEventLog(eventId: string): Promise<EventLogEntry[]>

  /** Change notifications for one event. `scoresOnly` lets the caller refetch cheaply. */
  subscribe(eventId: string, onChange: (what: 'scores' | 'all') => void): () => void
}

export type { Player, Group, Round }
