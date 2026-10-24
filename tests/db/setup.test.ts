// The step-by-step setup (create_event_setup), registration questions and limits,
// public handicaps for net events, side games and payouts.
import { beforeAll, describe, expect, it } from 'vitest'
import { TestDb, type TestUser } from './harness'

let db: TestDb
let org: TestUser
let rando: TestUser
let sk: TestUser
let courseId: string
let teeId: string
const PARS = [4, 4, 3, 4, 5, 3, 5, 4, 4, 4, 3, 4, 4, 5, 3, 4, 4, 5]

const best2 = [{ from: 1, to: 18, method: 'best_ball', count: 2 }]
const setup = (over: Record<string, unknown> = {}) => ({
  name: 'Jimmy Roger Showdown 2027',
  course_id: courseId,
  timezone: 'America/Chicago',
  description: '3-man 2 low ball',
  team_size: 3,
  cumulative: true,
  tiebreak: 'share',
  scoring_basis: 'both',
  rounds: [
    { date: '2027-04-17', tee_id: teeId, segments: best2, start_type: 'shotgun', start_time: '08:00', starting_hole: 1, group_size: 3, use_flights: true },
    { date: '2027-04-18', tee_id: teeId, segments: best2, start_type: 'tee_times', start_time: '07:30', starting_hole: 1, group_size: 3, tee_interval_minutes: 9, use_flights: true },
  ],
  flights: ['Championship', 'First'],
  registration: { open: true, max_players: 6, waitlist_limit: 3, entry_fee_cents: 15000, payment_instructions: 'Pay at the shop', show_participants: true },
  questions: [
    { label: 'Do you need a cart?', kind: 'yes_no', required: true, per_player: true },
    { label: 'Shirt size', kind: 'choice', choices: ['S', 'M', 'L', 'XL'], required: false, per_player: true },
    { label: 'Anything else?', kind: 'text' },
  ],
  side_games: [
    { round_number: 1, kind: 'closest_to_pin', name: 'Closest to the pin', holes: [3, 6, 11, 15], per_hole_cents: 5000 },
    { round_number: 2, kind: 'skins', name: 'Net skins', basis: 'net', carryover: true, purse_cents: 50000 },
  ],
  payouts: [
    { basis: 'gross', flight_name: 'Championship', amounts_cents: [60000, 30000] },
    { basis: 'net', flight_name: 'First', amounts_cents: [40000] },
  ],
  ...over,
})

const create = async (who: TestUser, p: unknown) => (await db.as<{ id: string }>(who, 'select create_event_setup($1::jsonb) as id', [JSON.stringify(p)]))[0]!.id
const codeOf = async (id: string) => (await db.admin<{ public_code: string }>('select public_code from events where id = $1', [id]))[0]!.public_code
const person = (first: string, last: string, email = '') => ({ first_name: first, last_name: last, email, phone: '' })
const team = (tag: string) => [person(tag, 'One', `${tag}1@x.co`), person(tag, 'Two', `${tag}2@x.co`), person(tag, 'Three', `${tag}3@x.co`)]

beforeAll(async () => {
  db = await TestDb.create()
  org = await db.user('chris@example.com')
  rando = await db.user('rando@example.com')
  sk = await db.user('scorer@example.com')
  await db.admin(`insert into organizers(email) values ('chris@example.com'), ('rando@example.com')`)
  const [c] = await db.as<{ id: string }>(org, `insert into courses(name) values ('Comanche Trail') returning id`)
  courseId = c!.id
  const [t] = await db.as<{ id: string }>(org, `insert into tees(course_id, name, rating, slope) values ($1, 'Blue', 71.5, 125) returning id`, [courseId])
  teeId = t!.id
  for (let i = 0; i < 18; i++)
    await db.as(org, 'insert into holes(tee_id, number, par, yardage, stroke_index) values ($1,$2,$3,380,$4)', [teeId, i + 1, PARS[i], i + 1])
}, 60_000)

describe('create_event_setup', () => {
  it('creates the event, rounds, flights, questions, side games and payouts in one call', async () => {
    const id = await create(org, setup())
    const [e] = await db.admin<Record<string, unknown>>('select team_size, event_date::text d, scoring_basis, registration_open, max_players, waitlist_limit, show_participants, status from events where id = $1', [id])
    expect(e).toMatchObject({ team_size: 3, d: '2027-04-17', scoring_basis: 'both', registration_open: true, max_players: 6, waitlist_limit: 3, show_participants: true, status: 'draft' })
    const rounds = await db.admin<Record<string, unknown>>('select round_number, start_type, start_time::text t, group_size, tee_interval_minutes from rounds where event_id = $1 order by round_number', [id])
    expect(rounds).toEqual([
      { round_number: 1, start_type: 'shotgun', t: '08:00:00', group_size: 3, tee_interval_minutes: 10 },
      { round_number: 2, start_type: 'tee_times', t: '07:30:00', group_size: 3, tee_interval_minutes: 9 },
    ])
    const fl = await db.admin<{ name: string }>('select name from flights where event_id = $1 order by sort_order', [id])
    expect(fl.map((f) => f.name)).toEqual(['Championship', 'First'])
    const qs = await db.admin<{ label: string; kind: string; choices: string[] }>('select label, kind, choices from registration_questions where event_id = $1 order by sort_order', [id])
    expect(qs.map((q) => q.kind)).toEqual(['yes_no', 'choice', 'text'])
    expect(qs[1]!.choices).toEqual(['S', 'M', 'L', 'XL'])
    const games = await db.admin<{ kind: string; holes: number[]; round_number: number }>('select g.kind, g.holes, r.round_number from side_games g join rounds r on r.id = g.round_id where g.event_id = $1 order by g.sort_order', [id])
    expect(games).toEqual([{ kind: 'closest_to_pin', holes: [3, 6, 11, 15], round_number: 1 }, { kind: 'skins', holes: [], round_number: 2 }])
    const pays = await db.admin<{ basis: string; flight: string; amounts_cents: number[] }>('select p.basis, f.name flight, p.amounts_cents from payout_tables p join flights f on f.id = p.flight_id where p.event_id = $1 order by p.basis', [id])
    expect(pays).toEqual([{ basis: 'gross', flight: 'Championship', amounts_cents: [60000, 30000] }, { basis: 'net', flight: 'First', amounts_cents: [40000] }])
  })

  it('only organizers can use it, and only with their own course', async () => {
    const nobody = await db.user('nobody@example.com')
    expect((await db.fails(nobody, 'select create_event_setup($1::jsonb)', [JSON.stringify(setup())])).code).toBe('PT403')
    expect((await db.fails(rando, 'select create_event_setup($1::jsonb)', [JSON.stringify(setup())])).message).toMatch(/Course not found/)
    expect((await db.fails('anon', 'select create_event_setup($1::jsonb)', [JSON.stringify(setup())])).message).toMatch(/permission denied/)
  })

  it('a template never opens registration', async () => {
    const id = await create(org, setup({ is_template: true }))
    const [e] = await db.admin<{ registration_open: boolean; is_template: boolean }>('select registration_open, is_template from events where id = $1', [id])
    expect(e).toEqual({ registration_open: false, is_template: true })
  })
})

describe('registration questions and limits', () => {
  let id: string
  let code: string
  let qid: Record<string, string>
  beforeAll(async () => {
    id = await create(org, setup())
    code = await codeOf(id)
    await db.as(org, `select set_event_status($1, 'published', '')`, [id])
    const qs = await db.admin<{ id: string; label: string }>('select id, label from registration_questions where event_id = $1', [id])
    qid = Object.fromEntries(qs.map((q) => [q.label, q.id]))
  })
  const answers = (cart: string[], extra: unknown[] = []) => JSON.stringify([...cart.map((v, i) => ({ question_id: qid['Do you need a cart?'], position: i + 1, value: v })), ...extra])
  const reg = (who: TestUser | 'anon', people: unknown[], ans: string) => db.as<{ r: { status: string } }>(who, 'select register_for_event($1,$2::jsonb,$3,$4,$5::jsonb) as r', [code, JSON.stringify(people), '', '', ans])
  const regFails = (people: unknown[], ans: string) => db.fails('anon', 'select register_for_event($1,$2::jsonb,$3,$4,$5::jsonb)', [code, JSON.stringify(people), '', '', ans])

  it('anyone can read the questions; required ones must be answered for each player', async () => {
    const q = await db.as<{ label: string }>('anon', 'select label from registration_questions where event_id = $1', [id])
    expect(q).toHaveLength(3)
    expect((await regFails(team('A'), answers(['Yes', 'No']))).message).toMatch(/Do you need a cart\?.*player 3/)
  })

  it('checks yes/no and choice answers', async () => {
    expect((await regFails(team('A'), answers(['Yes', 'No', 'Maybe']))).message).toMatch(/Yes or No/)
    const bad = [{ question_id: qid['Shirt size'], position: 1, value: 'XXXL' }]
    expect((await regFails(team('A'), answers(['Yes', 'No', 'No'], bad))).message).toMatch(/one of the options/)
  })

  it('stores answers, visible to admins only', async () => {
    const extra = [{ question_id: qid['Shirt size'], position: 2, value: 'L' }, { question_id: qid['Anything else?'], position: 0, value: 'Pair us with the Kempers' }]
    const [r] = await reg('anon', team('A'), answers(['Yes', 'No', 'Yes'], extra))
    expect(r!.r.status).toBe('confirmed')
    const mine = await db.as<{ position: number; value: string }>(org, 'select position, value from registration_answers where event_id = $1 order by question_id, position', [id])
    expect(mine).toHaveLength(5)
    expect(await db.as(rando, 'select * from registration_answers where event_id = $1', [id])).toHaveLength(0)
    expect((await db.fails('anon', 'select * from registration_answers')).message).toMatch(/permission denied/)
  })

  it('fills the field, then the waitlist, then refuses', async () => {
    await reg('anon', team('B'), answers(['No', 'No', 'No'])) // 6 players: full
    const [w] = await reg('anon', team('C'), answers(['No', 'No', 'No'])) // waitlist 3 of 3
    expect(w!.r.status).toBe('waitlisted')
    expect((await regFails(team('D'), answers(['No', 'No', 'No']))).message).toMatch(/waitlist are full/)
  })

  it("won't take sign-ups before the opening time", async () => {
    await db.as(org, `update events set registration_opens_at = now() + interval '2 days' where id = $1`, [id])
    expect((await regFails(team('E'), answers(['No', 'No', 'No']))).message).toMatch(/opens on/)
    await db.as(org, `update events set registration_opens_at = null where id = $1`, [id])
  })

  it('admins can correct answers, leaving optional ones blank', async () => {
    const [r] = await db.admin<{ id: string }>(`select r.id from registrations r where r.event_id = $1 order by created_at limit 1`, [id])
    await db.as(org, 'select set_registration_answers($1, $2::jsonb)', [r!.id, answers(['No', 'No', 'No'])])
    const rows = await db.admin<{ value: string }>(`select value from registration_answers where registration_id = $1 and question_id = $2 order by position`, [r!.id, qid['Do you need a cart?']])
    expect(rows.map((x) => x.value)).toEqual(['No', 'No', 'No'])
    expect((await db.fails(rando, 'select set_registration_answers($1, $2::jsonb)', [r!.id, '[]'])).code).toBe('PT403')
  })
})

describe('handicaps for net scoring', () => {
  it('Handicap Indexes are public only when the event scores net', async () => {
    const id = await create(org, setup({ scoring_basis: 'gross', registration: { open: false } }))
    await db.as(org, `select set_event_status($1, 'published', '')`, [id])
    const [p] = await db.as<{ id: string }>(org, `insert into players(event_id, first_name, last_name) values ($1, 'Ann', 'Ace') returning id`, [id])
    await db.as(org, `select set_player_handicap($1, 8.4, 'GHIN', '2027-04-01')`, [p!.id])
    expect(await db.as('anon', 'select * from event_handicaps($1)', [id])).toHaveLength(0)
    expect(await db.as(org, 'select * from event_handicaps($1)', [id])).toHaveLength(1)
    await db.as(org, `update events set scoring_basis = 'net' where id = $1`, [id])
    const rows = await db.as<{ handicap_index: string; source: string }>('anon', 'select * from event_handicaps($1)', [id])
    expect(rows).toHaveLength(1)
    expect(Number(rows[0]!.handicap_index)).toBe(8.4)
    expect(rows[0]!.source).toBe('GHIN')
  })
})

describe('side games and payouts', () => {
  let id: string
  let ctp: string
  let skins: string
  let player: string
  beforeAll(async () => {
    id = await create(org, setup({ registration: { open: false } }))
    await db.as(org, `select set_event_status($1, 'published', '')`, [id])
    const [t] = await db.as<{ id: string }>(org, `insert into teams(event_id, name) values ($1, 'Trio') returning id`, [id])
    const [p] = await db.as<{ id: string }>(org, `insert into players(event_id, first_name, last_name) values ($1, 'Cy', 'Close') returning id`, [id])
    player = p!.id
    await db.as(org, 'insert into team_members(team_id, player_id, event_id) values ($1,$2,$3)', [t!.id, player, id])
    const g = await db.admin<{ id: string; kind: string }>('select id, kind from side_games where event_id = $1', [id])
    ctp = g.find((x) => x.kind === 'closest_to_pin')!.id
    skins = g.find((x) => x.kind === 'skins')!.id
    await db.as(org, `insert into event_staff(event_id, email, role) values ($1, 'scorer@example.com', 'scorekeeper')`, [id])
    await db.as(sk, 'select claim_staff_invites()')
  })

  it('staff record a closest-to-the-pin winner; everyone can see it', async () => {
    await db.as(sk, 'select set_side_game_result($1, 3, $2, $3)', [ctp, player, "4' 2\""])
    const rows = await db.as<{ hole: number; note: string; entry_id: string }>('anon', 'select hole, note, entry_id from side_game_results where game_id = $1', [ctp])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.entry_id).toBeTruthy()
    await db.as(org, 'select set_side_game_result($1, 3, null, $2)', [ctp, ''])
    expect(await db.as('anon', 'select * from side_game_results where game_id = $1', [ctp])).toHaveLength(0)
  })

  it('refuses outsiders, holes outside the contest, and skins (worked out from scores)', async () => {
    expect((await db.fails(rando, 'select set_side_game_result($1, 3, $2, $3)', [ctp, player, ''])).code).toBe('PT403')
    expect((await db.fails(sk, 'select set_side_game_result($1, 4, $2, $3)', [ctp, player, ''])).message).toMatch(/isn't part/)
    expect((await db.fails(org, 'select set_side_game_result($1, 4, $2, $3)', [skins, player, ''])).message).toMatch(/worked out/)
    expect((await db.fails('anon', 'insert into side_game_results(game_id, event_id, hole) values ($1,$2,1)', [ctp, id])).message).toMatch(/permission denied/)
  })

  it('purses are public unless hidden', async () => {
    expect(await db.as('anon', 'select * from payout_tables where event_id = $1', [id])).toHaveLength(2)
    await db.as(org, 'update events set hide_purse = true where id = $1', [id])
    expect(await db.as('anon', 'select * from payout_tables where event_id = $1', [id])).toHaveLength(0)
    expect(await db.as(org, 'select * from payout_tables where event_id = $1', [id])).toHaveLength(2)
  })

  it('copying the event brings side games, questions and payouts, mapped to the new rounds and flights', async () => {
    const [c] = await db.as<{ id: string }>(org, `select duplicate_event($1, 'Copy 2028', '2028-04-15', false) as id`, [id])
    const games = await db.admin<{ round_number: number; round_event: string }>('select r.round_number, r.event_id round_event from side_games g join rounds r on r.id = g.round_id where g.event_id = $1 order by r.round_number', [c!.id])
    expect(games.map((g) => g.round_number)).toEqual([1, 2])
    expect(games.every((g) => g.round_event === c!.id)).toBe(true)
    const pays = await db.admin<{ flight_event: string }>('select f.event_id flight_event from payout_tables p join flights f on f.id = p.flight_id where p.event_id = $1', [c!.id])
    expect(pays).toHaveLength(2)
    expect(pays.every((p) => p.flight_event === c!.id)).toBe(true)
    const [q] = await db.admin<{ n: number }>('select count(*)::int n from registration_questions where event_id = $1', [c!.id])
    expect(q!.n).toBe(3)
    const [r2] = await db.admin<{ d: string; t: string }>('select round_date::text d, start_time::text t from rounds where event_id = $1 and round_number = 2', [c!.id])
    expect(r2).toEqual({ d: '2028-04-16', t: '07:30:00' })
  })

  it("a side game can't point at another event's round", async () => {
    const other = await create(org, setup({ registration: { open: false } }))
    const [r] = await db.admin<{ id: string }>('select id from rounds where event_id = $1 limit 1', [other])
    expect((await db.fails(org, `insert into side_games(event_id, round_id, kind, name) values ($1, $2, 'skins', 'x')`, [id, r!.id])).message).toMatch(/foreign key/)
  })
})
