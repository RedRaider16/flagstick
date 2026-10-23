// Domain model shared by the demo store, the Supabase store and the UI.
// Field names are camelCase here; the database uses snake_case.

export type EventStatus = 'draft' | 'published' | 'in_progress' | 'finalized'
export type RoundStatus = 'open' | 'locked' | 'finalized'
export type Format = 'stroke_individual' | 'scramble_2'
export type StartType = 'tee_times' | 'shotgun'
export type TiebreakPolicy = 'share' | 'card_back'
export type EntryStatus = 'active' | 'wd' | 'dq' | 'dnf' | 'ns'
export type StaffRole = 'admin' | 'scorekeeper'

export const FORMAT_LABEL: Record<Format, string> = {
  stroke_individual: 'Individual stroke play (gross)',
  scramble_2: 'Two-person scramble (gross)',
}

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  in_progress: 'In progress',
  finalized: 'Final',
}

export const TIEBREAK_LABEL: Record<TiebreakPolicy, string> = {
  share: 'Ties stand (shared positions)',
  card_back: 'Matching scorecards (holes 10–18, 13–18, 16–18, 18, then 4–9, 7–9, 9)',
}

export interface Course {
  id: string
  name: string
  city: string
}

export interface Tee {
  id: string
  courseId: string
  name: string
  /** Optional now; needed later for net scoring. */
  rating: number | null
  slope: number | null
}

export interface Hole {
  teeId: string
  number: number
  par: number
  yardage: number | null
  strokeIndex: number
}

export interface GolfEvent {
  id: string
  publicCode: string
  name: string
  courseId: string
  date: string // YYYY-MM-DD
  timezone: string // IANA, e.g. America/Chicago
  description: string
  status: EventStatus
  tiebreakPolicy: TiebreakPolicy
  createdAt: string
  registration: RegistrationSettings
}

export interface RegistrationSettings {
  open: boolean
  /** ISO timestamp, or null for no closing time. */
  closesAt: string | null
  /** Field limit in players, or null for no limit. */
  maxPlayers: number | null
  /** Entry fee per player in cents, or null if none is shown. */
  entryFeeCents: number | null
  /** Shown to players on the sign-up page, e.g. "Pay at the pro shop". */
  paymentInstructions: string
}

export const NO_REGISTRATION: RegistrationSettings = { open: false, closesAt: null, maxPlayers: null, entryFeeCents: null, paymentInstructions: '' }

export type RegistrationStatus = 'confirmed' | 'waitlisted' | 'cancelled'
export type PaymentStatus = 'unpaid' | 'paid' | 'waived' | 'refunded'
export type PaymentMethod = '' | 'cash' | 'check' | 'card' | 'online' | 'other'

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = { unpaid: 'Unpaid', paid: 'Paid', waived: 'Waived', refunded: 'Refunded' }
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = { '': '—', cash: 'Cash', check: 'Check', card: 'Card', online: 'Online', other: 'Other' }

export interface RegistrationPerson {
  position: number
  firstName: string
  lastName: string
  email: string
  phone: string
  handicapIndex: number | null
  playerId: string | null
}

export interface Registration {
  id: string
  eventId: string
  ref: string
  status: RegistrationStatus
  teamName: string
  teamId: string | null
  registrantNote: string
  paymentStatus: PaymentStatus
  paymentMethod: PaymentMethod
  amountPaidCents: number | null
  adminNote: string
  source: 'online' | 'admin'
  createdAt: string
  people: RegistrationPerson[]
}

/** What a player types on the public sign-up form. */
export interface RegistrantInput {
  firstName: string
  lastName: string
  email: string
  phone: string
  /** As typed, e.g. "12.4" or "+1.2"; blank if unknown. */
  handicapIndex: string
}

export interface RegisterResult {
  status: 'confirmed' | 'waitlisted'
  ref: string
  teamName: string | null
}

/** Handicap Index as given, with source and date. Not a Course or Playing Handicap. */
export interface PlayerHandicap {
  playerId: string
  handicapIndex: number
  source: string
  asOf: string
}

export function formatHandicapIndex(n: number | null | undefined): string {
  if (n === null || n === undefined) return ''
  return n < 0 ? `+${Math.abs(n).toFixed(1)}` : n.toFixed(1)
}

/** Parse a typed handicap index. Golf writes "plus" handicaps as +1.2, stored as -1.2. */
export function parseHandicapIndex(text: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const t = text.trim()
  if (!t) return { ok: true, value: null }
  const m = /^(\+)?(\d{1,2})(\.\d)?$/.exec(t)
  if (!m) return { ok: false, error: 'Use a number with up to one decimal, like 12.4 (or +1.2 for a plus handicap).' }
  const v = Number(`${m[2]}${m[3] ?? ''}`) * (m[1] ? -1 : 1)
  if (v < -10 || v > 54) return { ok: false, error: 'Handicap index must be between +10.0 and 54.0.' }
  return { ok: true, value: v }
}

export function formatMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return ''
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export interface Round {
  id: string
  eventId: string
  roundNumber: number
  date: string
  teeId: string | null
  format: Format
  startType: StartType
  status: RoundStatus
}

export interface Player {
  id: string
  eventId: string
  firstName: string
  lastName: string
}

/** Admin-only. Never shown on public screens or exports meant for spectators. */
export interface PlayerContact {
  playerId: string
  email: string
  phone: string
}

export interface Team {
  id: string
  eventId: string
  name: string
  playerIds: string[]
}

export interface Entry {
  id: string
  eventId: string
  kind: 'player' | 'team'
  playerId: string | null
  teamId: string | null
  status: EntryStatus
  statusNote: string
}

export interface Group {
  id: string
  roundId: string
  name: string
  teeTime: string | null // HH:MM local to the event timezone
  startingHole: number
  entryIds: string[]
}

export interface Score {
  id: string
  roundId: string
  entryId: string
  hole: number
  strokes: number
  version: number
  updatedAt: string
  updatedBy: string | null
}

export interface ScoreAudit {
  id: string
  roundId: string
  entryId: string
  hole: number
  action: 'insert' | 'update' | 'delete'
  oldStrokes: number | null
  newStrokes: number | null
  reason: string
  changedBy: string | null
  changedByLabel: string
  changedAt: string
}

export interface EventLogEntry {
  id: string
  eventId: string
  action: string
  detail: string
  actorLabel: string
  at: string
}

export interface StaffMember {
  id: string
  eventId: string
  email: string
  role: StaffRole
  userId: string | null
  groupIds: string[]
}

/** Everything a screen needs to render one event. */
export interface EventBundle {
  event: GolfEvent
  course: Course | null
  tee: Tee | null
  holes: Hole[]
  round: Round
  players: Player[]
  teams: Team[]
  entries: Entry[]
  groups: Group[]
  scores: Score[]
}

export function playerName(p: Pick<Player, 'firstName' | 'lastName'>): string {
  return `${p.firstName} ${p.lastName}`.trim()
}

export function entryName(entry: Entry, players: Player[], teams: Team[]): string {
  if (entry.kind === 'player') {
    const p = players.find((x) => x.id === entry.playerId)
    return p ? playerName(p) : 'Unknown player'
  }
  const t = teams.find((x) => x.id === entry.teamId)
  if (!t) return 'Unknown team'
  const members = t.playerIds
    .map((id) => players.find((p) => p.id === id))
    .filter((p): p is Player => !!p)
    .map((p) => p.lastName || p.firstName)
  return members.length ? `${t.name} (${members.join(' / ')})` : t.name
}
