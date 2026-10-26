// Connected mode. Every permission is enforced in Postgres (RLS + SECURITY DEFINER
// functions in supabase/migrations). This class only translates between the app's
// camelCase model and the database, and turns database errors into AppErrors.
import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js'
import type {
  Course,
  Entry,
  EntryStatus,
  EventBundle,
  EventLogEntry,
  EventStatus,
  Flight,
  GolfEvent,
  Group,
  Hole,
  PaymentMethod,
  PaymentStatus,
  Player,
  PlayerContact,
  PayoutTable,
  PlayerHandicap,
  RegisterResult,
  RegistrationAnswer,
  RegistrationQuestion,
  SideGame,
  SideGameResult,
  RegistrantInput,
  Registration,
  RegistrationSettings,
  Round,
  Score,
  ScoreAudit,
  StaffMember,
  StaffRole,
  Team,
  Tee,
} from '../domain/types'
import type { HoleInput } from '../scoring/validation'
import { AppError, type ErrorKind } from './errors'
import { DEFAULT_ALLOWANCES, type NetAllowances } from '../scoring/handicap'
import type { Access, AnswerInput, CourseDetail, EventPatch, EventSetup, GroupInput, NewEventInput, PlayerInput, QuestionInput, Repo, RoundPatch, ScoreSlot, SessionUser, SideGameInput } from './repo'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export const liveConfig = {
  url: (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? '',
  key: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() ?? '',
}
export const liveConfigured = Boolean(liveConfig.url && liveConfig.key)

// ── mapping ──
const mapEvent = (r: Row): GolfEvent => ({
  id: r.id, publicCode: r.public_code, name: r.name, courseId: r.course_id, date: r.event_date, timezone: r.timezone,
  description: r.description, status: r.status, tiebreakPolicy: r.tiebreak_policy, createdAt: r.created_at,
  registration: {
    open: Boolean(r.registration_open),
    closesAt: r.registration_closes_at ?? null,
    maxPlayers: r.max_players ?? null,
    entryFeeCents: r.entry_fee_cents ?? null,
    paymentInstructions: r.payment_instructions ?? '',
    opensAt: r.registration_opens_at ?? null,
    waitlistLimit: r.waitlist_limit ?? null,
    showParticipants: Boolean(r.show_participants),
  },
  teamSize: r.team_size ?? 1,
  cumulative: r.cumulative ?? true,
  isTemplate: Boolean(r.is_template),
  scoringBasis: r.scoring_basis ?? 'gross',
  netAllowances: mapAllowances(r.net_allowances),
  maxHandicapIndex: r.max_handicap_index === null || r.max_handicap_index === undefined ? null : Number(r.max_handicap_index),
  hidePurse: Boolean(r.hide_purse),
})
function mapAllowances(j: Row | null | undefined): NetAllowances {
  if (!j) return DEFAULT_ALLOWANCES
  const scramble: Record<number, number[]> = { ...DEFAULT_ALLOWANCES.scramble }
  for (const [k, v] of Object.entries((j.scramble as Row) ?? {})) scramble[Number(k)] = (v as unknown[]).map(Number)
  return {
    individual: Number(j.individual ?? DEFAULT_ALLOWANCES.individual),
    bestBall: Number(j.bestBall ?? DEFAULT_ALLOWANCES.bestBall),
    scramble,
    altShot: Number(j.altShot ?? DEFAULT_ALLOWANCES.altShot),
  }
}
const mapQuestion = (r: Row): RegistrationQuestion => ({
  id: r.id, eventId: r.event_id, label: r.label, kind: r.kind, choices: r.choices ?? [], required: r.required, perPlayer: r.per_player, sortOrder: r.sort_order,
})
const questionRow = (q: QuestionInput) => ({
  label: q.label.trim(), kind: q.kind, choices: q.kind === 'choice' ? q.choices.map((c) => c.trim()).filter(Boolean) : [],
  required: q.required, per_player: q.perPlayer, sort_order: q.sortOrder,
})
const sideGameRow = (g: SideGameInput) => ({
  kind: g.kind, name: g.name.trim(), holes: g.kind === 'skins' ? [] : g.holes, basis: g.basis, carryover: g.carryover,
  purse_cents: g.purseCents, per_hole_cents: g.perHoleCents, sort_order: g.sortOrder,
})
const mapPayout = (r: Row): PayoutTable => ({
  id: r.id, eventId: r.event_id, basis: r.basis, roundId: r.round_id ?? null, flightId: r.flight_id ?? null, amountsCents: (r.amounts_cents ?? []).map(Number),
})
const mapRound = (r: Row): Round => ({
  id: r.id, eventId: r.event_id, roundNumber: r.round_number, date: r.round_date, teeId: r.tee_id,
  segments: (r.segments as Row[]).map((x) => ({ from: Number(x.from), to: Number(x.to), method: x.method, count: Number(x.count ?? 1) })),
  useFlights: r.use_flights ?? true, startType: r.start_type, status: r.status,
  startTime: r.start_time ? String(r.start_time).slice(0, 5) : null, startingHole: r.starting_hole ?? 1,
  groupSize: r.group_size ?? 4, teeIntervalMinutes: r.tee_interval_minutes ?? 10, groupsPerTime: r.groups_per_time ?? 1,
})
const mapScore = (r: Row): Score => ({
  id: r.id, roundId: r.round_id, entryId: r.entry_id, playerId: r.player_id ?? null, hole: r.hole, strokes: r.strokes, version: r.version,
  updatedAt: r.updated_at, updatedBy: r.updated_by,
})
const mapFlight = (r: Row): Flight => ({ id: r.id, eventId: r.event_id, name: r.name, sortOrder: r.sort_order })
const slotArgs = (s: ScoreSlot) => ({ p_round: s.roundId, p_entry: s.entryId, p_hole: s.hole, p_player: s.playerId })
const mapTee = (r: Row): Tee => ({ id: r.id, courseId: r.course_id, name: r.name, rating: r.rating === null ? null : Number(r.rating), slope: r.slope })
const mapHole = (r: Row): Hole => ({ teeId: r.tee_id, number: r.number, par: r.par, yardage: r.yardage, strokeIndex: r.stroke_index })
const mapCourse = (r: Row): Course => ({ id: r.id, name: r.name, city: r.city })
const mapEntry = (r: Row): Entry => ({
  id: r.id, eventId: r.event_id, kind: r.kind, playerId: r.player_id, teamId: r.team_id, status: r.status, statusNote: r.status_note,
  flightId: r.flight_id ?? null,
})
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null)

function toAppError(e: PostgrestError | Error | null, status?: number): AppError {
  if (!e) return new AppError('Unknown error', 'unknown')
  if (e instanceof AppError) return e
  const pe = e as PostgrestError
  const code = pe.code ?? ''
  const msg = pe.message || 'Something went wrong.'
  if (/fetch|network|Load failed/i.test(msg) && !code) return new AppError('Network problem — check your connection and try again.', 'network')
  const byCode: Record<string, ErrorKind> = {
    PT400: 'invalid', PT401: 'auth', PT403: 'forbidden', PT404: 'not_found', PT409: 'conflict',
    '42501': 'forbidden', '23505': 'conflict', '23503': 'invalid', '23514': 'invalid', '22P02': 'invalid',
  }
  let kind: ErrorKind = byCode[code] ?? 'unknown'
  if (kind === 'unknown' && status) kind = status === 409 ? 'conflict' : status === 403 ? 'forbidden' : status === 401 ? 'auth' : 'unknown'
  let current: Score | null | undefined
  if (kind === 'conflict' && pe.details) {
    try {
      const d = JSON.parse(pe.details) as { current: Row | null }
      current = d.current ? mapScore(d.current) : null
    } catch {
      /* details weren't JSON — not a score conflict */
    }
  }
  const friendly =
    code === '42501' ? "You don't have permission to do that."
    : code === '23505' ? 'That already exists.'
    : code === '23514' ? 'One of the values is out of range.'
    : msg
  return new AppError(friendly, kind, current)
}

async function run<T>(p: PromiseLike<{ data: T; error: PostgrestError | null; status?: number }>): Promise<T> {
  let res: { data: T; error: PostgrestError | null; status?: number }
  try {
    res = await p
  } catch (e) {
    throw new AppError(e instanceof Error && /fetch/i.test(e.message) ? 'Network problem — check your connection and try again.' : String(e), 'network')
  }
  if (res.error) throw toAppError(res.error, res.status)
  return res.data
}

export class SupabaseRepo implements Repo {
  readonly mode = 'live' as const
  readonly sb: SupabaseClient

  constructor() {
    if (!liveConfigured) throw new Error('Supabase is not configured')
    this.sb = createClient(liveConfig.url, liveConfig.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
    this.sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') void this.sb.rpc('claim_staff_invites')
    })
  }

  // ── Session ──
  async currentUser(): Promise<SessionUser | null> {
    const { data } = await this.sb.auth.getSession()
    const u = data.session?.user
    return u ? { id: u.id, email: u.email ?? '' } : null
  }
  onAuthChange(cb: () => void) {
    const { data } = this.sb.auth.onAuthStateChange(() => cb())
    return () => data.subscription.unsubscribe()
  }
  async requestSignIn(email: string) {
    const redirect = `${window.location.origin}${import.meta.env.BASE_URL}`
    const { error } = await this.sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirect } })
    if (error) throw new AppError(error.message, 'auth')
  }
  async verifyCode(email: string, code: string) {
    const { error } = await this.sb.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
    if (error) throw new AppError(error.message, 'auth')
    await this.sb.rpc('claim_staff_invites')
  }
  async signOut() {
    await this.sb.auth.signOut()
  }

  // ── Discovery ──
  async myEvents() {
    const user = await this.currentUser()
    if (!user) return []
    await this.sb.rpc('claim_staff_invites')
    const staff = await run(this.sb.from('event_staff').select('event_id').eq('user_id', user.id))
    const ids = [...new Set((staff as Row[]).map((s) => s.event_id as string))]
    if (!ids.length) return []
    const rows = await run(this.sb.from('events').select('*').in('id', ids).order('event_date', { ascending: false }))
    return (rows as Row[]).map(mapEvent)
  }
  async findEventByCode(code: string) {
    const rows = await run(this.sb.from('events').select('*').eq('public_code', code.trim().toUpperCase()).limit(1))
    const r = (rows as Row[])[0]
    return r ? mapEvent(r) : null
  }
  async isOrganizer() {
    if (!(await this.currentUser())) return false
    return Boolean(await run(this.sb.rpc('is_organizer')))
  }
  async access(eventId: string): Promise<Access> {
    const user = await this.currentUser()
    if (!user) return { isOrganizer: false, role: null, groupIds: [] }
    const [org, staff] = await Promise.all([
      this.isOrganizer(),
      run(this.sb.from('event_staff').select('id, role').eq('event_id', eventId).eq('user_id', user.id)),
    ])
    const rows = staff as Row[]
    const role: StaffRole | null = rows.some((r) => r.role === 'admin') ? 'admin' : rows.length ? 'scorekeeper' : null
    let groupIds: string[] = []
    if (rows.length) {
      const sg = await run(this.sb.from('staff_groups').select('group_id').in('staff_id', rows.map((r) => r.id)))
      groupIds = (sg as Row[]).map((r) => r.group_id)
    }
    return { isOrganizer: org, role, groupIds }
  }

  // ── Courses ──
  async listCourses() {
    const user = await this.currentUser()
    if (!user) return []
    return ((await run(this.sb.from('courses').select('*').eq('owner_id', user.id).order('name'))) as Row[]).map(mapCourse)
  }
  async courseDetail(courseId: string): Promise<CourseDetail> {
    const [c, tees] = await Promise.all([
      run(this.sb.from('courses').select('*').eq('id', courseId).single()),
      run(this.sb.from('tees').select('*').eq('course_id', courseId).order('name')),
    ])
    const teeIds = (tees as Row[]).map((t) => t.id)
    const holes = teeIds.length ? ((await run(this.sb.from('holes').select('*').in('tee_id', teeIds).order('number'))) as Row[]) : []
    return { course: mapCourse(c as Row), tees: (tees as Row[]).map(mapTee), holes: holes.map(mapHole) }
  }
  async createCourse(name: string, city: string) {
    const r = await run(this.sb.from('courses').insert({ name: name.trim(), city: city.trim() }).select('id').single())
    return (r as Row).id as string
  }
  async updateTee(teeId: string, t: { rating: number | null; slope: number | null }) {
    await run(this.sb.from('tees').update({ rating: t.rating, slope: t.slope }).eq('id', teeId))
  }
  async createTee(courseId: string, name: string) {
    const r = await run(this.sb.from('tees').insert({ course_id: courseId, name: name.trim() }).select('id').single())
    return (r as Row).id as string
  }
  async saveHoles(teeId: string, holes: HoleInput[]) {
    // Upsert all 18 in one statement; the deferred unique(stroke_index) lets SIs swap.
    await run(
      this.sb.from('holes').upsert(
        holes.map((h) => ({ tee_id: teeId, number: h.number, par: h.par, yardage: h.yardage, stroke_index: h.strokeIndex })),
        { onConflict: 'tee_id,number' },
      ),
    )
  }

  // ── Events ──
  async createEvent(i: NewEventInput) {
    const id = await run(
      this.sb.rpc('create_event', {
        p_name: i.name.trim(), p_course: i.courseId, p_tee: i.teeId, p_date: i.date, p_timezone: i.timezone,
        p_description: i.description, p_team_size: i.teamSize, p_segments: i.segments, p_start_type: i.startType, p_tiebreak: i.tiebreak,
      }),
    )
    return id as string
  }

  async createEventSetup(s: EventSetup) {
    const p = {
      name: s.name.trim(), course_id: s.courseId, timezone: s.timezone, description: s.description,
      team_size: s.teamSize, cumulative: s.cumulative, tiebreak: s.tiebreak, is_template: s.isTemplate,
      scoring_basis: s.scoringBasis, net_allowances: s.netAllowances, max_handicap_index: s.maxHandicapIndex, hide_purse: s.hidePurse,
      rounds: s.rounds.map((r) => ({
        date: r.date, tee_id: r.teeId, segments: r.segments, start_type: r.startType, start_time: r.startTime,
        starting_hole: r.startingHole, group_size: r.groupSize, tee_interval_minutes: r.teeIntervalMinutes, groups_per_time: r.groupsPerTime ?? 1, use_flights: r.useFlights,
      })),
      flights: s.flights,
      registration: {
        open: s.registration.open, opens_at: s.registration.opensAt, closes_at: s.registration.closesAt,
        max_players: s.registration.maxPlayers, waitlist_limit: s.registration.waitlistLimit,
        entry_fee_cents: s.registration.entryFeeCents, payment_instructions: s.registration.paymentInstructions,
        show_participants: s.registration.showParticipants,
      },
      questions: s.questions.map((q) => ({ ...questionRow(q), per_player: q.perPlayer })),
      side_games: s.sideGames.map((g) => ({ round_number: g.roundNumber, ...sideGameRow(g) })),
      payouts: s.payouts.map((x) => ({ basis: x.basis, round_number: x.roundNumber, flight_name: x.flightName, amounts_cents: x.amountsCents })),
    }
    return (await run(this.sb.rpc('create_event_setup', { p }))) as string
  }

  async loadBundle(eventId: string): Promise<EventBundle> {
    const evRows = (await run(this.sb.from('events').select('*').eq('id', eventId).limit(1))) as Row[]
    if (!evRows[0]) throw new AppError('Event not found, or it is not published yet.', 'not_found')
    const event = mapEvent(evRows[0])
    const [rounds, course, tees, players, teams, members, entries, flights, groups, groupEntries, scores] = await Promise.all([
      run(this.sb.from('rounds').select('*').eq('event_id', eventId).order('round_number')),
      run(this.sb.from('courses').select('*').eq('id', event.courseId).maybeSingle()),
      run(this.sb.from('tees').select('*').eq('course_id', event.courseId).order('name')),
      run(this.sb.from('players').select('*').eq('event_id', eventId).order('last_name')),
      run(this.sb.from('teams').select('*').eq('event_id', eventId).order('name')),
      run(this.sb.from('team_members').select('*').eq('event_id', eventId)),
      run(this.sb.from('entries').select('*').eq('event_id', eventId)),
      run(this.sb.from('flights').select('*').eq('event_id', eventId).order('sort_order').order('name')),
      run(this.sb.from('groups').select('*').eq('event_id', eventId).order('name')),
      run(this.sb.from('group_entries').select('*').eq('event_id', eventId)),
      this.listScores(eventId),
    ])
    const [questions, sideGames, sideEntries, sideResults, payouts, handicaps] = await Promise.all([
      run(this.sb.from('registration_questions').select('*').eq('event_id', eventId).order('sort_order')),
      run(this.sb.from('side_games').select('*').eq('event_id', eventId).order('sort_order')),
      run(this.sb.from('side_game_entries').select('*').eq('event_id', eventId)),
      run(this.sb.from('side_game_results').select('*').eq('event_id', eventId)),
      run(this.sb.from('payout_tables').select('*').eq('event_id', eventId)),
      run(this.sb.rpc('event_handicaps', { p_event: eventId })),
    ])
    const teeIds = (tees as Row[]).map((t) => t.id)
    const holes = teeIds.length ? ((await run(this.sb.from('holes').select('*').in('tee_id', teeIds).order('number'))) as Row[]) : []
    const memberRows = members as Row[]
    const geRows = groupEntries as Row[]
    return {
      event,
      course: course ? mapCourse(course as Row) : null,
      tees: (tees as Row[]).map(mapTee),
      holes: holes.map(mapHole),
      rounds: (rounds as Row[]).map(mapRound),
      flights: (flights as Row[]).map(mapFlight),
      players: (players as Row[]).map((p): Player => ({ id: p.id, eventId: p.event_id, firstName: p.first_name, lastName: p.last_name, teeId: p.tee_id ?? null })),
      teams: (teams as Row[]).map((t): Team => ({
        id: t.id, eventId: t.event_id, name: t.name,
        playerIds: memberRows.filter((m) => m.team_id === t.id).map((m) => m.player_id),
      })),
      entries: (entries as Row[]).map(mapEntry),
      groups: (groups as Row[]).map((g): Group => ({
        id: g.id, roundId: g.round_id, name: g.name, teeTime: hhmm(g.tee_time), startingHole: g.starting_hole,
        entryIds: geRows.filter((x) => x.group_id === g.id).map((x) => x.entry_id),
      })),
      scores,
      questions: (questions as Row[]).map(mapQuestion),
      sideGames: (sideGames as Row[]).map((g): SideGame => ({
        id: g.id, eventId: g.event_id, roundId: g.round_id, kind: g.kind, name: g.name, holes: g.holes ?? [], basis: g.basis,
        carryover: g.carryover, purseCents: g.purse_cents, perHoleCents: g.per_hole_cents, sortOrder: g.sort_order,
        entryIds: (sideEntries as Row[]).filter((x) => x.game_id === g.id).map((x) => x.entry_id),
      })),
      sideGameResults: (sideResults as Row[]).map((r): SideGameResult => ({ gameId: r.game_id, hole: r.hole, playerId: r.player_id, entryId: r.entry_id, note: r.note })),
      payouts: (payouts as Row[]).map(mapPayout),
      handicaps: ((handicaps as Row[] | null) ?? []).map((r) => ({ playerId: r.player_id, handicapIndex: Number(r.handicap_index), source: r.source, asOf: r.as_of })),
    }
  }

  async updateEvent(eventId: string, patch: EventPatch) {
    const row: Row = {}
    if (patch.name !== undefined) row.name = patch.name.trim()
    if (patch.date !== undefined) row.event_date = patch.date
    if (patch.timezone !== undefined) row.timezone = patch.timezone
    if (patch.description !== undefined) row.description = patch.description
    if (patch.tiebreakPolicy !== undefined) row.tiebreak_policy = patch.tiebreakPolicy
    if (patch.teamSize !== undefined) row.team_size = patch.teamSize
    if (patch.cumulative !== undefined) row.cumulative = patch.cumulative
    if (patch.isTemplate !== undefined) row.is_template = patch.isTemplate
    if (patch.scoringBasis !== undefined) row.scoring_basis = patch.scoringBasis
    if (patch.netAllowances !== undefined) row.net_allowances = patch.netAllowances
    if (patch.maxHandicapIndex !== undefined) row.max_handicap_index = patch.maxHandicapIndex
    if (patch.hidePurse !== undefined) row.hide_purse = patch.hidePurse
    await run(this.sb.from('events').update(row).eq('id', eventId))
  }
  async updateRegistrationSettings(eventId: string, r: RegistrationSettings) {
    await run(
      this.sb.from('events').update({
        registration_open: r.open, registration_closes_at: r.closesAt, max_players: r.maxPlayers,
        entry_fee_cents: r.entryFeeCents, payment_instructions: r.paymentInstructions,
        registration_opens_at: r.opensAt, waitlist_limit: r.waitlistLimit, show_participants: r.showParticipants,
      }).eq('id', eventId),
    )
  }
  async updateRound(roundId: string, patch: RoundPatch) {
    const row: Row = {}
    if (patch.date !== undefined) row.round_date = patch.date
    if (patch.teeId !== undefined) row.tee_id = patch.teeId
    if (patch.segments !== undefined) row.segments = patch.segments
    if (patch.useFlights !== undefined) row.use_flights = patch.useFlights
    if (patch.startType !== undefined) row.start_type = patch.startType
    if (patch.startTime !== undefined) row.start_time = patch.startTime
    if (patch.startingHole !== undefined) row.starting_hole = patch.startingHole
    if (patch.groupSize !== undefined) row.group_size = patch.groupSize
    if (patch.teeIntervalMinutes !== undefined) row.tee_interval_minutes = patch.teeIntervalMinutes
    if (patch.groupsPerTime !== undefined) row.groups_per_time = patch.groupsPerTime
    await run(this.sb.from('rounds').update(row).eq('id', roundId))
  }
  async addRound(eventId: string) {
    return (await run(this.sb.rpc('add_round', { p_event: eventId }))) as string
  }
  async deleteRound(roundId: string) {
    await run(this.sb.rpc('delete_round', { p_round: roundId }))
  }
  async duplicateEvent(eventId: string, name: string, date: string, asTemplate: boolean) {
    return (await run(this.sb.rpc('duplicate_event', { p_source: eventId, p_name: name, p_date: date, p_as_template: asTemplate }))) as string
  }

  // ── Flights ──
  async createFlight(eventId: string, name: string, sortOrder: number) {
    const r = await run(this.sb.from('flights').insert({ event_id: eventId, name: name.trim(), sort_order: sortOrder }).select('id').single())
    return (r as Row).id as string
  }
  async updateFlight(flightId: string, name: string, sortOrder: number) {
    await run(this.sb.from('flights').update({ name: name.trim(), sort_order: sortOrder }).eq('id', flightId))
  }
  async deleteFlight(flightId: string) {
    await run(this.sb.from('flights').delete().eq('id', flightId))
  }
  async setEntryFlights(eventId: string, assignments: { entryId: string; flightId: string | null }[]) {
    await run(this.sb.rpc('set_entry_flights', { p_event: eventId, p_assignments: assignments.map((a) => ({ entry_id: a.entryId, flight_id: a.flightId })) }))
  }

  async deleteEvent(eventId: string) {
    const rows = await run(this.sb.from('events').delete().eq('id', eventId).select('id'))
    if (!(rows as Row[]).length) throw new AppError('Only draft events can be deleted, and only by an admin.', 'forbidden')
  }

  // ── Roster ──
  async addPlayer(eventId: string, p: PlayerInput) {
    const r = await run(this.sb.from('players').insert({ event_id: eventId, first_name: p.firstName.trim(), last_name: p.lastName.trim() }).select('id').single())
    const id = (r as Row).id as string
    await run(this.sb.from('player_contacts').insert({ player_id: id, event_id: eventId, email: p.email.trim(), phone: p.phone.trim() }))
    return id
  }
  async updatePlayer(playerId: string, eventId: string, p: PlayerInput) {
    await run(this.sb.from('players').update({ first_name: p.firstName.trim(), last_name: p.lastName.trim() }).eq('id', playerId))
    await run(this.sb.from('player_contacts').upsert({ player_id: playerId, event_id: eventId, email: p.email.trim(), phone: p.phone.trim() }))
  }
  async removePlayer(playerId: string) {
    await run(this.sb.from('players').delete().eq('id', playerId))
  }
  async setPlayerTee(playerId: string, teeId: string | null) {
    await run(this.sb.from('players').update({ tee_id: teeId }).eq('id', playerId))
  }
  async listContacts(eventId: string): Promise<PlayerContact[]> {
    const rows = await run(this.sb.from('player_contacts').select('*').eq('event_id', eventId))
    return (rows as Row[]).map((r) => ({ playerId: r.player_id, email: r.email, phone: r.phone }))
  }
  async createTeam(eventId: string, name: string, playerIds: string[]) {
    const r = await run(this.sb.from('teams').insert({ event_id: eventId, name: name.trim() }).select('id').single())
    const id = (r as Row).id as string
    if (playerIds.length) {
      try {
        await run(this.sb.from('team_members').insert(playerIds.map((pid) => ({ team_id: id, player_id: pid, event_id: eventId }))))
      } catch (e) {
        await this.sb.from('teams').delete().eq('id', id)
        throw e
      }
    }
    return id
  }
  async updateTeam(teamId: string, eventId: string, name: string, playerIds: string[]) {
    if (name.trim()) await run(this.sb.from('teams').update({ name: name.trim() }).eq('id', teamId))
    const cur = ((await run(this.sb.from('team_members').select('player_id').eq('team_id', teamId))) as Row[]).map((r) => r.player_id as string)
    const remove = cur.filter((x) => !playerIds.includes(x))
    const add = playerIds.filter((x) => !cur.includes(x))
    if (remove.length) await run(this.sb.from('team_members').delete().eq('team_id', teamId).in('player_id', remove))
    if (add.length) await run(this.sb.from('team_members').insert(add.map((pid) => ({ team_id: teamId, player_id: pid, event_id: eventId }))))
  }
  async deleteTeam(teamId: string) {
    await run(this.sb.from('teams').delete().eq('id', teamId))
  }
  async setEntryStatus(entryId: string, status: EntryStatus, note: string) {
    await run(this.sb.rpc('set_entry_status', { p_entry: entryId, p_status: status, p_note: note }))
  }

  // ── Registration ──
  async register(code: string, people: RegistrantInput[], teamName: string, note: string, answers: AnswerInput[]): Promise<RegisterResult> {
    const res = (await run(
      this.sb.rpc('register_for_event', {
        p_code: code,
        p_people: people.map((x) => ({
          first_name: x.firstName, last_name: x.lastName, email: x.email, phone: x.phone,
          // DB stores plus handicaps as negatives; the form converts before calling.
          handicap_index: x.handicapIndex,
        })),
        p_team_name: teamName,
        p_note: note,
        p_answers: answers.map((a) => ({ question_id: a.questionId, position: a.position, value: a.value })),
      }),
    )) as Row
    return { status: res.status, ref: res.ref, teamName: res.team_name ?? null }
  }
  async createQuestion(eventId: string, q: QuestionInput) {
    const r = await run(this.sb.from('registration_questions').insert({ event_id: eventId, ...questionRow(q) }).select('id').single())
    return (r as Row).id as string
  }
  async updateQuestion(questionId: string, q: QuestionInput) {
    await run(this.sb.from('registration_questions').update(questionRow(q)).eq('id', questionId))
  }
  async deleteQuestion(questionId: string) {
    await run(this.sb.from('registration_questions').delete().eq('id', questionId))
  }
  async listAnswers(eventId: string): Promise<RegistrationAnswer[]> {
    const rows = await run(this.sb.from('registration_answers').select('*').eq('event_id', eventId))
    return (rows as Row[]).map((r) => ({ registrationId: r.registration_id, questionId: r.question_id, position: r.position, value: r.value }))
  }
  async setRegistrationAnswers(regId: string, answers: AnswerInput[]) {
    await run(this.sb.rpc('set_registration_answers', { p_reg: regId, p_answers: answers.map((a) => ({ question_id: a.questionId, position: a.position, value: a.value })) }))
  }

  // ── Side games and payouts ──
  async createSideGame(eventId: string, roundId: string, g: SideGameInput) {
    const r = await run(this.sb.from('side_games').insert({ event_id: eventId, round_id: roundId, ...sideGameRow(g) }).select('id').single())
    return (r as Row).id as string
  }
  async updateSideGame(gameId: string, g: SideGameInput) {
    await run(this.sb.from('side_games').update(sideGameRow(g)).eq('id', gameId))
  }
  async deleteSideGame(gameId: string) {
    await run(this.sb.from('side_games').delete().eq('id', gameId))
  }
  async setSideGameEntries(gameId: string, eventId: string, entryIds: string[]) {
    await run(this.sb.from('side_game_entries').delete().eq('game_id', gameId))
    if (entryIds.length) await run(this.sb.from('side_game_entries').insert(entryIds.map((e) => ({ game_id: gameId, entry_id: e, event_id: eventId }))))
  }
  async setSideGameResult(gameId: string, hole: number, playerId: string | null, note: string) {
    await run(this.sb.rpc('set_side_game_result', { p_game: gameId, p_hole: hole, p_player: playerId, p_note: note }))
  }
  async savePayoutTable(eventId: string, t: Omit<PayoutTable, 'id' | 'eventId'>) {
    let q = this.sb.from('payout_tables').delete().eq('event_id', eventId).eq('basis', t.basis)
    q = t.roundId ? q.eq('round_id', t.roundId) : q.is('round_id', null)
    q = t.flightId ? q.eq('flight_id', t.flightId) : q.is('flight_id', null)
    await run(q)
    if (t.amountsCents.some((a) => a > 0))
      await run(this.sb.from('payout_tables').insert({ event_id: eventId, basis: t.basis, round_id: t.roundId, flight_id: t.flightId, amounts_cents: t.amountsCents }))
  }
  async listRegistrations(eventId: string): Promise<Registration[]> {
    const [regs, people] = await Promise.all([
      run(this.sb.from('registrations').select('*').eq('event_id', eventId).order('created_at')),
      run(this.sb.from('registration_players').select('*').eq('event_id', eventId).order('position')),
    ])
    return (regs as Row[]).map((r) => ({
      id: r.id, eventId: r.event_id, ref: r.ref, status: r.status, teamName: r.team_name, teamId: r.team_id,
      registrantNote: r.registrant_note, paymentStatus: r.payment_status, paymentMethod: r.payment_method,
      amountPaidCents: r.amount_paid_cents, adminNote: r.admin_note, source: r.source, createdAt: r.created_at,
      people: (people as Row[]).filter((p) => p.registration_id === r.id).map((p) => ({
        position: p.position, firstName: p.first_name, lastName: p.last_name, email: p.email, phone: p.phone,
        handicapIndex: p.handicap_index === null ? null : Number(p.handicap_index), playerId: p.player_id,
      })),
    }))
  }
  async updateRegistrationPayment(regId: string, p: { paymentStatus: PaymentStatus; paymentMethod: PaymentMethod; amountPaidCents: number | null; adminNote: string }) {
    const rows = await run(
      this.sb.from('registrations').update({
        payment_status: p.paymentStatus, payment_method: p.paymentMethod, amount_paid_cents: p.amountPaidCents, admin_note: p.adminNote,
      }).eq('id', regId).select('id'),
    )
    if (!(rows as Row[]).length) throw new AppError('Only admins can record payments.', 'forbidden')
  }
  async promoteRegistration(regId: string) {
    await run(this.sb.rpc('promote_registration', { p_reg: regId }))
  }
  async cancelRegistration(regId: string, reason: string) {
    await run(this.sb.rpc('cancel_registration', { p_reg: regId, p_reason: reason }))
  }
  async listHandicaps(eventId: string): Promise<PlayerHandicap[]> {
    const rows = await run(this.sb.from('player_handicaps').select('*').eq('event_id', eventId))
    return (rows as Row[]).map((r) => ({ playerId: r.player_id, handicapIndex: Number(r.handicap_index), source: r.source, asOf: r.as_of }))
  }
  async setPlayerHandicap(playerId: string, index: number | null, source: string, asOf: string) {
    await run(this.sb.rpc('set_player_handicap', { p_player: playerId, p_index: index, p_source: source, p_as_of: asOf || null }))
  }

  // ── Groups ──
  async createGroup(roundId: string, eventId: string, g: GroupInput) {
    const r = await run(
      this.sb.from('groups').insert({ round_id: roundId, event_id: eventId, name: g.name.trim(), tee_time: g.teeTime, starting_hole: g.startingHole }).select('id').single(),
    )
    return (r as Row).id as string
  }
  async updateGroup(groupId: string, g: GroupInput) {
    await run(this.sb.from('groups').update({ name: g.name.trim(), tee_time: g.teeTime, starting_hole: g.startingHole }).eq('id', groupId))
  }
  async deleteGroup(groupId: string) {
    await run(this.sb.from('groups').delete().eq('id', groupId))
  }
  async assignEntry(roundId: string, eventId: string, entryId: string, groupId: string | null) {
    await run(this.sb.from('group_entries').delete().eq('round_id', roundId).eq('entry_id', entryId))
    if (groupId) await run(this.sb.from('group_entries').insert({ group_id: groupId, round_id: roundId, entry_id: entryId, event_id: eventId }))
  }

  // ── Staff ──
  async listStaff(eventId: string): Promise<StaffMember[]> {
    const [staff, sg] = await Promise.all([
      run(this.sb.from('event_staff').select('*').eq('event_id', eventId).order('role').order('email')),
      run(this.sb.from('staff_groups').select('*').eq('event_id', eventId)),
    ])
    return (staff as Row[]).map((s) => ({
      id: s.id, eventId: s.event_id, email: s.email, role: s.role, userId: s.user_id,
      groupIds: (sg as Row[]).filter((x) => x.staff_id === s.id).map((x) => x.group_id),
    }))
  }
  async inviteStaff(eventId: string, email: string, role: StaffRole) {
    await run(this.sb.from('event_staff').insert({ event_id: eventId, email: email.trim().toLowerCase(), role }))
  }
  async removeStaff(staffId: string) {
    const rows = await run(this.sb.from('event_staff').delete().eq('id', staffId).select('id'))
    if (!(rows as Row[]).length) throw new AppError("That staff member couldn't be removed (you can't remove yourself).", 'forbidden')
  }
  async setStaffGroups(staffId: string, eventId: string, groupIds: string[]) {
    await run(this.sb.from('staff_groups').delete().eq('staff_id', staffId))
    if (groupIds.length) await run(this.sb.from('staff_groups').insert(groupIds.map((g) => ({ staff_id: staffId, group_id: g, event_id: eventId }))))
  }

  // ── Status ──
  async startBlockers(eventId: string) {
    return ((await run(this.sb.rpc('start_blockers', { p_event: eventId }))) as string[] | null) ?? []
  }
  async setEventStatus(eventId: string, status: EventStatus, reason: string) {
    await run(this.sb.rpc('set_event_status', { p_event: eventId, p_status: status, p_reason: reason }))
  }
  async setRoundLock(roundId: string, locked: boolean, reason: string) {
    await run(this.sb.rpc('set_round_lock', { p_round: roundId, p_locked: locked, p_reason: reason }))
  }
  async finalizeRound(roundId: string, reason: string) {
    await run(this.sb.rpc('finalize_round', { p_round: roundId, p_reason: reason }))
  }
  async reopenRound(roundId: string, reason: string) {
    await run(this.sb.rpc('reopen_round', { p_round: roundId, p_reason: reason }))
  }

  // ── Scores ──
  async setScore(slot: ScoreSlot, strokes: number, expectedVersion: number | null, reason: string, cardCode?: string) {
    const r = cardCode
      ? await run(this.sb.rpc('card_set_score', { p_token: cardCode, p_entry: slot.entryId, p_hole: slot.hole, p_strokes: strokes, p_expected_version: expectedVersion, p_player: slot.playerId }).single())
      : await run(this.sb.rpc('set_score', { ...slotArgs(slot), p_strokes: strokes, p_expected_version: expectedVersion, p_reason: reason }).single())
    return mapScore(r as Row)
  }
  async clearScore(slot: ScoreSlot, expectedVersion: number, reason: string, cardCode?: string) {
    if (cardCode) await run(this.sb.rpc('card_clear_score', { p_token: cardCode, p_entry: slot.entryId, p_hole: slot.hole, p_expected_version: expectedVersion, p_player: slot.playerId }))
    else await run(this.sb.rpc('clear_score', { ...slotArgs(slot), p_expected_version: expectedVersion, p_reason: reason }))
  }
  async scoringCardCodes(roundId: string) {
    const rows = (await run(this.sb.rpc('scoring_card_codes', { p_round: roundId }))) as Row[]
    return new Map(rows.map((r) => [r.group_id as string, r.token as string]))
  }
  async resetScoringCards(roundId: string) {
    await run(this.sb.rpc('reset_scoring_cards', { p_round: roundId }))
  }
  async scoringCard(code: string) {
    if (!/^[0-9a-f]{32}$/i.test(code)) return null
    const rows = (await run(this.sb.rpc('scoring_card', { p_token: code }))) as Row[]
    const r = rows[0]
    return r ? { eventId: r.event_id as string, roundId: r.round_id as string, groupId: r.group_id as string } : null
  }
  async listScores(eventId: string) {
    // 45 teams × 3 players × 18 holes × 2 rounds ≈ 4,900 rows; page past PostgREST's 1,000-row cap.
    const out: Score[] = []
    for (let from = 0; ; from += 1000) {
      const rows = (await run(this.sb.from('scores').select('*').eq('event_id', eventId).order('id').range(from, from + 999))) as Row[]
      out.push(...rows.map(mapScore))
      if (rows.length < 1000) break
    }
    return out
  }
  async listAudit(eventId: string): Promise<ScoreAudit[]> {
    const rows = await run(this.sb.from('score_audit').select('*').eq('event_id', eventId).order('id', { ascending: false }).limit(500))
    return (rows as Row[]).map((r) => ({
      id: String(r.id), roundId: r.round_id, entryId: r.entry_id, playerId: r.player_id ?? null, hole: r.hole, action: r.action, oldStrokes: r.old_strokes,
      newStrokes: r.new_strokes, reason: r.reason, changedBy: r.changed_by, changedByLabel: r.changed_by_email || 'database console', changedAt: r.changed_at,
    }))
  }
  async listEventLog(eventId: string): Promise<EventLogEntry[]> {
    const rows = await run(this.sb.from('event_log').select('*').eq('event_id', eventId).order('id', { ascending: false }).limit(300))
    return (rows as Row[]).map((r) => ({ id: String(r.id), eventId: r.event_id, action: r.action, detail: r.detail, actorLabel: r.actor_email || 'database console', at: r.at }))
  }

  subscribe(eventId: string, onChange: (what: 'scores' | 'all') => void) {
    const ch = this.sb
      .channel(`event-${eventId}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores', filter: `event_id=eq.${eventId}` }, () => onChange('scores'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'entries', filter: `event_id=eq.${eventId}` }, () => onChange('all'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${eventId}` }, () => onChange('all'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds', filter: `event_id=eq.${eventId}` }, () => onChange('all'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flights', filter: `event_id=eq.${eventId}` }, () => onChange('all'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations', filter: `event_id=eq.${eventId}` }, () => onChange('all'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'side_games', filter: `event_id=eq.${eventId}` }, () => onChange('all'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'side_game_results', filter: `event_id=eq.${eventId}` }, () => onChange('all'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payout_tables', filter: `event_id=eq.${eventId}` }, () => onChange('all'))
      .subscribe()
    return () => void this.sb.removeChannel(ch)
  }
}
