// Domain model shared by the demo store, the Supabase store and the UI.
// Field names are camelCase here; the database uses snake_case.
import type { Segment } from '../scoring/formats'
import type { NetAllowances } from '../scoring/handicap'
export type { Segment, NetAllowances }

export type EventStatus = 'draft' | 'published' | 'in_progress' | 'finalized'
export type RoundStatus = 'open' | 'locked' | 'finalized'
export type StartType = 'tee_times' | 'shotgun'
export type TiebreakPolicy = 'share' | 'card_back'
export type EntryStatus = 'active' | 'wd' | 'dq' | 'dnf' | 'ns'
export type StaffRole = 'admin' | 'scorekeeper'

export const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = {
  active: 'Playing',
  wd: 'Withdrew (WD)',
  dq: 'Disqualified (DQ)',
  dnf: 'Did not finish (DNF)',
  ns: 'No show (NS)',
}

export const TEAM_SIZE_LABEL: Record<number, string> = {
  1: 'Individual',
  2: '2-person teams',
  3: '3-person teams',
  4: '4-person teams',
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
  /** 1 = individual; 2–4 = teams of that size. */
  teamSize: number
  /** true: one overall leaderboard across rounds. false: each round is its own competition. */
  cumulative: boolean
  /** A reusable setup for an annual event. Stays a draft; copy it to run this year's event. */
  isTemplate: boolean
  /** Which leaderboards to show. Net needs Handicap Indexes and tee ratings. */
  scoringBasis: ScoringBasis
  netAllowances: NetAllowances
  /** Cap on the Handicap Index used for net scoring (e.g. 42.0), or null. */
  maxHandicapIndex: number | null
  /** Keep prize money off public screens. */
  hidePurse: boolean
}

export type ScoringBasis = 'gross' | 'net' | 'both'
export const SCORING_BASIS_LABEL: Record<ScoringBasis, string> = { gross: 'Gross only', net: 'Net only', both: 'Gross and net' }

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
  /** ISO timestamp sign-ups start, or null to start as soon as registration is open. */
  opensAt: string | null
  /** Players allowed on the waitlist once the field is full; null = no limit. */
  waitlistLimit: number | null
  /** Show who has registered on the public event page. */
  showParticipants: boolean
}

export const NO_REGISTRATION: RegistrationSettings = {
  open: false, closesAt: null, maxPlayers: null, entryFeeCents: null, paymentInstructions: '',
  opensAt: null, waitlistLimit: null, showParticipants: false,
}

export type QuestionKind = 'text' | 'yes_no' | 'choice'
export const QUESTION_KIND_LABEL: Record<QuestionKind, string> = { text: 'Short answer', yes_no: 'Yes / No', choice: 'Pick one' }

/** A question the organizer adds to the sign-up form, e.g. "Do you need a cart?" */
export interface RegistrationQuestion {
  id: string
  eventId: string
  label: string
  kind: QuestionKind
  choices: string[]
  required: boolean
  /** Ask each player on a team, rather than once per sign-up. */
  perPlayer: boolean
  sortOrder: number
}

export interface RegistrationAnswer {
  registrationId: string
  questionId: string
  /** 0 = once per sign-up; 1–4 = that player. */
  position: number
  value: string
}

export type SideGameKind = 'skins' | 'closest_to_pin' | 'long_drive'
export const SIDE_GAME_LABEL: Record<SideGameKind, string> = { skins: 'Skins', closest_to_pin: 'Closest to the pin', long_drive: 'Long drive' }

export interface SideGame {
  id: string
  eventId: string
  roundId: string
  kind: SideGameKind
  name: string
  /** Contest holes (closest to the pin, long drive). Skins use all 18. */
  holes: number[]
  basis: 'gross' | 'net'
  carryover: boolean
  /** Skins: total purse shared by the skins won. */
  purseCents: number
  /** Closest to the pin / long drive: paid to each hole's winner. */
  perHoleCents: number
  sortOrder: number
  /** Entries playing (skins). Empty = everyone. */
  entryIds: string[]
}

export interface SideGameResult {
  gameId: string
  hole: number
  playerId: string | null
  entryId: string | null
  note: string
}

export interface PayoutTable {
  id: string
  eventId: string
  basis: 'gross' | 'net'
  /** null = the overall result (or the only round). */
  roundId: string | null
  /** null = the whole field. */
  flightId: string | null
  /** Place money: amountsCents[0] for 1st, and so on. */
  amountsCents: number[]
}

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
  /** Hole ranges and how each is scored. See scoring/formats.ts. */
  segments: Segment[]
  /** Split this round's leaderboard by flight. */
  useFlights: boolean
  startType: StartType
  status: RoundStatus
  /** Shotgun time, or the first tee time (HH:MM). */
  startTime: string | null
  /** Shotgun: where the first group starts; tee times: the first tee. */
  startingHole: number
  /** Players (or teams, in team events of 3–4) per group on the tee sheet. */
  groupSize: number
  teeIntervalMinutes: number
  /** Tee times: groups going off at the same time (1A, 1B …). */
  groupsPerTime: number
}

export interface Flight {
  id: string
  eventId: string
  name: string
  sortOrder: number
}

export interface Player {
  id: string
  eventId: string
  firstName: string
  lastName: string
  /** Tee this player plays when it differs from the round's (individual events). */
  teeId: string | null
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
  flightId: string | null
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
  /** Set on best-ball holes (one score per player); null for team and individual scores. */
  playerId: string | null
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
  playerId: string | null
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

/** Everything a screen needs to render one event (all rounds). */
export interface EventBundle {
  event: GolfEvent
  course: Course | null
  /** Every tee on the course. */
  tees: Tee[]
  /** Holes for every tee on the course. */
  holes: Hole[]
  /** In round order. */
  rounds: Round[]
  flights: Flight[]
  players: Player[]
  teams: Team[]
  entries: Entry[]
  /** Groups of every round. */
  groups: Group[]
  /** Scores of every round. */
  scores: Score[]
  questions: RegistrationQuestion[]
  sideGames: SideGame[]
  sideGameResults: SideGameResult[]
  /** Hidden from spectators when the organizer hides the purse. */
  payouts: PayoutTable[]
  /** Handicap Indexes: public for net events, otherwise admins only (empty for others). */
  handicaps: PlayerHandicap[]
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

// ── Confirmation emails ──

export interface EmailSettings {
  enabled: boolean
  fromName: string
  fromAddress: string
  replyTo: string
}

export type EmailKind = 'registered' | 'waitlisted' | 'promoted' | 'cancelled'
export const EMAIL_KIND_LABEL: Record<EmailKind, string> = {
  registered: 'Registered',
  waitlisted: 'Waitlisted',
  promoted: 'Off the waitlist',
  cancelled: 'Cancelled',
}

export interface EmailLog {
  id: string
  registrationId: string | null
  kind: EmailKind
  toEmail: string
  subject: string
  body: string
  status: 'pending' | 'sending' | 'sent' | 'failed'
  attempts: number
  lastError: string
  createdAt: string
  sentAt: string | null
}
