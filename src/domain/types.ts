// Domain model shared by the demo store, the Supabase store and the UI.
// Field names are camelCase here; the database uses snake_case.

export type EventStatus = 'draft' | 'published' | 'in_progress' | 'finalized'
export type RoundStatus = 'open' | 'locked' | 'finalized'
export type Format = 'stroke_individual' | 'scramble_2'
export type StartType = 'tee_times' | 'shotgun'
export type TiebreakPolicy = 'share' | 'card_back'
export type EntryStatus = 'active' | 'wd' | 'dq'
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
