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
  Format,
  GolfEvent,
  Group,
  Hole,
  PaymentMethod,
  PaymentStatus,
  Player,
  PlayerContact,
  PlayerHandicap,
  RegisterResult,
  RegistrantInput,
  Registration,
  RegistrationSettings,
  Round,
  Score,
  ScoreAudit,
  StaffMember,
  StaffRole,
  StartType,
  Team,
  Tee,
} from '../domain/types'
import type { HoleInput } from '../scoring/validation'
import { AppError, type ErrorKind } from './errors'
import type { Access, CourseDetail, GroupInput, NewEventInput, PlayerInput, Repo, SessionUser } from './repo'

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
  },
})
const mapRound = (r: Row): Round => ({
  id: r.id, eventId: r.event_id, roundNumber: r.round_number, date: r.round_date, teeId: r.tee_id, format: r.format,
  startType: r.start_type, status: r.status,
})
const mapScore = (r: Row): Score => ({
  id: r.id, roundId: r.round_id, entryId: r.entry_id, hole: r.hole, strokes: r.strokes, version: r.version,
  updatedAt: r.updated_at, updatedBy: r.updated_by,
})
const mapTee = (r: Row): Tee => ({ id: r.id, courseId: r.course_id, name: r.name, rating: r.rating === null ? null : Number(r.rating), slope: r.slope })
const mapHole = (r: Row): Hole => ({ teeId: r.tee_id, number: r.number, par: r.par, yardage: r.yardage, strokeIndex: r.stroke_index })
const mapCourse = (r: Row): Course => ({ id: r.id, name: r.name, city: r.city })
const mapEntry = (r: Row): Entry => ({
  id: r.id, eventId: r.event_id, kind: r.kind, playerId: r.player_id, teamId: r.team_id, status: r.status, statusNote: r.status_note,
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
        p_description: i.description, p_format: i.format, p_start_type: i.startType, p_tiebreak: i.tiebreak,
      }),
    )
    return id as string
  }

  async loadBundle(eventId: string): Promise<EventBundle> {
    const evRows = (await run(this.sb.from('events').select('*').eq('id', eventId).limit(1))) as Row[]
    if (!evRows[0]) throw new AppError('Event not found, or it is not published yet.', 'not_found')
    const event = mapEvent(evRows[0])
    const [roundRows, course, players, teams, members, entries] = await Promise.all([
      run(this.sb.from('rounds').select('*').eq('event_id', eventId).order('round_number').limit(1)),
      run(this.sb.from('courses').select('*').eq('id', event.courseId).maybeSingle()),
      run(this.sb.from('players').select('*').eq('event_id', eventId).order('last_name')),
      run(this.sb.from('teams').select('*').eq('event_id', eventId).order('name')),
      run(this.sb.from('team_members').select('*').eq('event_id', eventId)),
      run(this.sb.from('entries').select('*').eq('event_id', eventId)),
    ])
    const round = mapRound((roundRows as Row[])[0]!)
    const [tee, holes, groups, groupEntries, scores] = await Promise.all([
      round.teeId ? run(this.sb.from('tees').select('*').eq('id', round.teeId).maybeSingle()) : Promise.resolve(null),
      round.teeId ? run(this.sb.from('holes').select('*').eq('tee_id', round.teeId).order('number')) : Promise.resolve([]),
      run(this.sb.from('groups').select('*').eq('round_id', round.id).order('name')),
      run(this.sb.from('group_entries').select('*').eq('round_id', round.id)),
      this.listScores(round.id),
    ])
    const memberRows = members as Row[]
    const geRows = groupEntries as Row[]
    return {
      event,
      course: course ? mapCourse(course as Row) : null,
      tee: tee ? mapTee(tee as Row) : null,
      holes: (holes as Row[]).map(mapHole),
      round,
      players: (players as Row[]).map((p): Player => ({ id: p.id, eventId: p.event_id, firstName: p.first_name, lastName: p.last_name })),
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
    }
  }

  async updateEvent(eventId: string, patch: Partial<Pick<GolfEvent, 'name' | 'date' | 'timezone' | 'description' | 'tiebreakPolicy'>>) {
    const row: Row = {}
    if (patch.name !== undefined) row.name = patch.name.trim()
    if (patch.date !== undefined) row.event_date = patch.date
    if (patch.timezone !== undefined) row.timezone = patch.timezone
    if (patch.description !== undefined) row.description = patch.description
    if (patch.tiebreakPolicy !== undefined) row.tiebreak_policy = patch.tiebreakPolicy
    await run(this.sb.from('events').update(row).eq('id', eventId))
    if (patch.date) await run(this.sb.from('rounds').update({ round_date: patch.date }).eq('event_id', eventId))
  }
  async updateRegistrationSettings(eventId: string, r: RegistrationSettings) {
    await run(
      this.sb.from('events').update({
        registration_open: r.open, registration_closes_at: r.closesAt, max_players: r.maxPlayers,
        entry_fee_cents: r.entryFeeCents, payment_instructions: r.paymentInstructions,
      }).eq('id', eventId),
    )
  }
  async updateRound(roundId: string, patch: { teeId?: string | null; format?: Format; startType?: StartType }) {
    const row: Row = {}
    if (patch.teeId !== undefined) row.tee_id = patch.teeId
    if (patch.format !== undefined) row.format = patch.format
    if (patch.startType !== undefined) row.start_type = patch.startType
    await run(this.sb.from('rounds').update(row).eq('id', roundId))
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
  async register(code: string, people: RegistrantInput[], teamName: string, note: string): Promise<RegisterResult> {
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
      }),
    )) as Row
    return { status: res.status, ref: res.ref, teamName: res.team_name ?? null }
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
  async setScore(roundId: string, entryId: string, hole: number, strokes: number, expectedVersion: number | null, reason: string) {
    const r = await run(
      this.sb.rpc('set_score', { p_round: roundId, p_entry: entryId, p_hole: hole, p_strokes: strokes, p_expected_version: expectedVersion, p_reason: reason }).single(),
    )
    return mapScore(r as Row)
  }
  async clearScore(roundId: string, entryId: string, hole: number, expectedVersion: number, reason: string) {
    await run(this.sb.rpc('clear_score', { p_round: roundId, p_entry: entryId, p_hole: hole, p_expected_version: expectedVersion, p_reason: reason }))
  }
  async listScores(roundId: string) {
    // 120 entries × 18 holes = 2,160 rows; page past PostgREST's default 1,000-row cap.
    const out: Score[] = []
    for (let from = 0; ; from += 1000) {
      const rows = (await run(this.sb.from('scores').select('*').eq('round_id', roundId).order('id').range(from, from + 999))) as Row[]
      out.push(...rows.map(mapScore))
      if (rows.length < 1000) break
    }
    return out
  }
  async listAudit(eventId: string): Promise<ScoreAudit[]> {
    const rows = await run(this.sb.from('score_audit').select('*').eq('event_id', eventId).order('id', { ascending: false }).limit(500))
    return (rows as Row[]).map((r) => ({
      id: String(r.id), roundId: r.round_id, entryId: r.entry_id, hole: r.hole, action: r.action, oldStrokes: r.old_strokes,
      newStrokes: r.new_strokes, reason: r.reason, changedBy: r.changed_by, changedByLabel: r.changed_by_email || 'database console', changedAt: r.changed_at,
    }))
  }
  async listEventLog(eventId: string): Promise<EventLogEntry[]> {
    const rows = await run(this.sb.from('event_log').select('*').eq('event_id', eventId).order('id', { ascending: false }).limit(300))
    return (rows as Row[]).map((r) => ({ id: String(r.id), eventId: r.event_id, action: r.action, detail: r.detail, actorLabel: r.actor_email || 'database console', at: r.at }))
  }

  subscribe(eventId: string, roundId: string, onChange: (what: 'scores' | 'all') => void) {
    const ch = this.sb
      .channel(`event-${eventId}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores', filter: `round_id=eq.${roundId}` }, () => onChange('scores'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'entries', filter: `event_id=eq.${eventId}` }, () => onChange('all'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${eventId}` }, () => onChange('all'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rounds', filter: `id=eq.${roundId}` }, () => onChange('all'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations', filter: `event_id=eq.${eventId}` }, () => onChange('all'))
      .subscribe()
    return () => void this.sb.removeChannel(ch)
  }
}
