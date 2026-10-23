import { beforeAll, describe, expect, it } from 'vitest'
import { TestDb, type TestUser } from './harness'

let db: TestDb
let org: TestUser
let rando: TestUser
const PARS = [4, 4, 3, 4, 5, 3, 5, 4, 4, 4, 3, 4, 4, 5, 3, 4, 4, 5]

interface Ev { id: string; code: string; round: string }

async function makeEvent(name: string, format: 'stroke_individual' | 'scramble_2', settings: Record<string, unknown> = {}): Promise<Ev> {
  const [course] = await db.as<{ id: string }>(org, `insert into courses(name) values ($1) returning id`, [`${name} CC`])
  const [tee] = await db.as<{ id: string }>(org, `insert into tees(course_id, name) values ($1, 'White') returning id`, [course!.id])
  for (let i = 0; i < 18; i++)
    await db.as(org, 'insert into holes(tee_id, number, par, yardage, stroke_index) values ($1,$2,$3,380,$4)', [tee!.id, i + 1, PARS[i], i + 1])
  const [ev] = await db.as<{ id: string }>(org, `select create_event($1,$2,$3,'2026-11-07','America/Chicago','',$4::int,null,'tee_times','share') as id`, [name, course!.id, tee!.id, format === 'scramble_2' ? 2 : 1])
  const cols = Object.keys(settings)
  if (cols.length)
    await db.as(org, `update events set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1`, [ev!.id, ...Object.values(settings)])
  const [row] = await db.as<{ public_code: string }>(org, 'select public_code from events where id = $1', [ev!.id])
  const [round] = await db.as<{ id: string }>(org, 'select id from rounds where event_id = $1', [ev!.id])
  return { id: ev!.id, code: row!.public_code, round: round!.id }
}

const person = (first: string, last: string, email = '', extra: Record<string, unknown> = {}) => ({ first_name: first, last_name: last, email, phone: '', ...extra })
interface RegResult { status: string; ref: string; team_name: string | null }
const register = async (who: TestUser | 'anon', code: string, people: unknown[], team = ''): Promise<RegResult> =>
  (await db.as<{ r: RegResult }>(who, 'select register_for_event($1, $2::jsonb, $3, $4) as r', [code, JSON.stringify(people), team, '']))[0]!.r
const registerFails = (who: TestUser | 'anon', code: string, people: unknown[], team = '') =>
  db.fails(who, 'select register_for_event($1, $2::jsonb, $3, $4)', [code, JSON.stringify(people), team, ''])

beforeAll(async () => {
  db = await TestDb.create()
  org = await db.user('chris@example.com')
  rando = await db.user('rando@example.com')
  await db.admin(`insert into organizers(email) values ('chris@example.com')`)
})

describe('opening and closing registration', () => {
  it('rejects registration for drafts, closed registration and past closing dates', async () => {
    const ev = await makeEvent('Closed Classic', 'stroke_individual')
    expect((await registerFails('anon', ev.code, [person('A', 'A', 'a@x.co')])).message).toMatch(/not open/)
    await db.as(org, `select set_event_status($1, 'published', '')`, [ev.id])
    expect((await registerFails('anon', ev.code, [person('A', 'A', 'a@x.co')])).message).toMatch(/closed/)
    await db.as(org, `update events set registration_open = true, registration_closes_at = now() - interval '1 hour' where id = $1`, [ev.id])
    expect((await registerFails('anon', ev.code, [person('A', 'A', 'a@x.co')])).message).toMatch(/closed on/)
  })

  it('an unknown code is rejected', async () => {
    expect((await registerFails('anon', 'ZZZZZZ', [person('A', 'A', 'a@x.co')])).code).toBe('PT404')
  })

  it('only admins can change registration settings', async () => {
    const ev = await makeEvent('Settings Open', 'stroke_individual')
    const n = await db.as(rando, `update events set registration_open = true where id = $1 returning id`, [ev.id])
    expect(n).toHaveLength(0)
    expect((await db.fails('anon', `update events set registration_open = true where id = $1`, [ev.id])).message).toMatch(/permission denied/)
    await db.as(org, `update events set registration_open = true, max_players = 10 where id = $1`, [ev.id])
  })
})

describe('individual registration', () => {
  let ev: Ev
  beforeAll(async () => {
    ev = await makeEvent('Individual Open', 'stroke_individual', { registration_open: true, max_players: 3 })
    await db.as(org, `select set_event_status($1, 'published', '')`, [ev.id])
  })

  it('a spectator registers without an account and becomes a player + entry', async () => {
    const r = await register('anon', ev.code, [person('Ava', 'Stone', 'Ava@Example.com', { phone: '432-555-0100', handicap_index: '12.4' })])
    expect(r.status).toBe('confirmed')
    expect(r.ref).toMatch(/^[A-Z2-9]{6}$/)
    const players = await db.as<{ first_name: string }>('anon', 'select first_name from players where event_id = $1', [ev.id])
    expect(players.map((p) => p.first_name)).toEqual(['Ava'])
    const entries = await db.as('anon', 'select id from entries where event_id = $1', [ev.id])
    expect(entries).toHaveLength(1)
  })

  it('stores contact details and handicap privately, with source and date', async () => {
    const [c] = await db.as<{ email: string; phone: string }>(org, 'select email, phone from player_contacts where event_id = $1', [ev.id])
    expect(c).toEqual({ email: 'ava@example.com', phone: '432-555-0100' })
    const [h] = await db.as<{ handicap_index: string; source: string }>(org, 'select handicap_index, source from player_handicaps where event_id = $1', [ev.id])
    expect(Number(h!.handicap_index)).toBe(12.4)
    expect(h!.source).toBe('Self-reported at registration')
    expect(await db.as('anon', 'select * from player_contacts')).toHaveLength(0)
    expect((await db.fails('anon', 'select * from player_handicaps')).message).toMatch(/permission denied/)
    expect(await db.as(rando, 'select * from player_handicaps')).toHaveLength(0)
  })

  it('registrations are admin-only', async () => {
    expect((await db.fails('anon', 'select * from registrations')).message).toMatch(/permission denied/)
    expect(await db.as(rando, 'select * from registrations')).toHaveLength(0)
    expect(await db.as(org, 'select * from registrations where event_id = $1', [ev.id])).toHaveLength(1)
  })

  it('rejects a duplicate email (case-insensitive) and bad input', async () => {
    expect((await registerFails('anon', ev.code, [person('Ava', 'Again', 'ava@EXAMPLE.com')])).message).toMatch(/already registered/)
    expect((await registerFails('anon', ev.code, [person('', 'X', 'x@x.co')])).code).toBe('PT400')
    expect((await registerFails('anon', ev.code, [person('No', 'Email')])).message).toMatch(/email address is required/)
    expect((await registerFails('anon', ev.code, [person('Bad', 'Hcp', 'b@x.co', { handicap_index: 'abc' })])).message).toMatch(/number like/)
    expect((await registerFails('anon', ev.code, [person('Big', 'Hcp', 'c@x.co', { handicap_index: '60' })])).message).toMatch(/between/)
    expect((await registerFails('anon', ev.code, [person('A', 'A', 'd@x.co'), person('B', 'B', 'e@x.co')])).message).toMatch(/one player/)
  })

  it('fills the field, then waitlists without creating players', async () => {
    await register('anon', ev.code, [person('Bo', 'Birdie', 'bo@x.co')])
    await register(rando, ev.code, [person('Cy', 'Chip', 'cy@x.co')])
    const r = await register('anon', ev.code, [person('Di', 'Duff', 'di@x.co')])
    expect(r.status).toBe('waitlisted')
    const players = await db.as('anon', 'select id from players where event_id = $1', [ev.id])
    expect(players).toHaveLength(3)
  })

  it('admin promotes from the waitlist; it creates the player and is logged', async () => {
    const [w] = await db.as<{ id: string }>(org, `select id from registrations where event_id = $1 and status = 'waitlisted'`, [ev.id])
    expect((await db.fails(rando, 'select promote_registration($1)', [w!.id])).code).toBe('PT403')
    await db.as(org, 'select promote_registration($1)', [w!.id])
    expect(await db.as('anon', 'select id from players where event_id = $1', [ev.id])).toHaveLength(4)
    const log = await db.as<{ action: string }>(org, 'select action from event_log where event_id = $1', [ev.id])
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(['registration_confirmed', 'registration_waitlisted', 'registration_promoted']))
  })

  it('admin records payment; others cannot', async () => {
    const [reg] = await db.as<{ id: string }>(org, 'select id from registrations where event_id = $1 order by created_at limit 1', [ev.id])
    await db.as(org, `update registrations set payment_status = 'paid', payment_method = 'cash', amount_paid_cents = 6000 where id = $1`, [reg!.id])
    const [r] = await db.as<{ payment_status: string; amount_paid_cents: number }>(org, 'select payment_status, amount_paid_cents from registrations where id = $1', [reg!.id])
    expect(r).toEqual({ payment_status: 'paid', amount_paid_cents: 6000 })
    expect(await db.as(rando, `update registrations set payment_status = 'paid' where id = $1 returning id`, [reg!.id])).toHaveLength(0)
    expect((await db.fails(org, `update registrations set status = 'cancelled' where id = $1`, [reg!.id])).message).toMatch(/permission denied/)
    expect((await db.fails(org, `update registrations set payment_status = 'free' where id = $1`, [reg!.id])).message).toMatch(/check constraint/)
  })

  it('cancelling removes the player and entry, and frees the email', async () => {
    const [reg] = await db.as<{ id: string }>(org, `select r.id from registrations r join registration_players p on p.registration_id = r.id where p.email = 'bo@x.co'`)
    await db.as(org, `select cancel_registration($1, 'cannot make it')`, [reg!.id])
    const names = (await db.as<{ first_name: string }>('anon', 'select first_name from players where event_id = $1 order by first_name', [ev.id])).map((p) => p.first_name)
    expect(names).toEqual(['Ava', 'Cy', 'Di'])
    // The email is accepted again (not "already registered"). The field is still full
    // (3 of 3 after the admin promoted one over the limit), so it goes to the waitlist.
    const r = await register('anon', ev.code, [person('Bo', 'Birdie', 'bo@x.co')])
    expect(r.status).toBe('waitlisted')
    await db.as(org, 'update events set max_players = 6 where id = $1', [ev.id])
    const r2 = await register('anon', ev.code, [person('Ed', 'Eagle', 'ed@x.co')])
    expect(r2.status).toBe('confirmed')
  })

  it('cannot cancel a registration that has scores', async () => {
    await db.as(org, `update events set registration_open = false where id = $1`, [ev.id])
    await db.as(org, `insert into groups(round_id, event_id, name) values ($1, $2, 'G1')`, [ev.round, ev.id])
    const [g] = await db.as<{ id: string }>(org, 'select id from groups where round_id = $1', [ev.round])
    const entries = await db.as<{ id: string }>(org, 'select id from entries where event_id = $1', [ev.id])
    for (const e of entries) await db.as(org, 'insert into group_entries(group_id, round_id, entry_id, event_id) values ($1,$2,$3,$4)', [g!.id, ev.round, e.id, ev.id])
    await db.as(org, `select set_event_status($1, 'in_progress', '')`, [ev.id])
    const [ava] = await db.as<{ entry: string; reg: string }>(org,
      `select e.id as entry, rp.registration_id as reg from registration_players rp join entries e on e.player_id = rp.player_id where rp.email = 'ava@example.com'`)
    await db.as(org, 'select * from set_score($1,$2,1,4,null,$3)', [ev.round, ava!.entry, ''])
    expect((await db.fails(org, `select cancel_registration($1, '')`, [ava!.reg])).message).toMatch(/has scores/)
  })
})

describe('two-person scramble registration', () => {
  let ev: Ev
  beforeAll(async () => {
    ev = await makeEvent('Scramble Signup', 'scramble_2', { registration_open: true, max_players: 4 })
    await db.as(org, `select set_event_status($1, 'published', '')`, [ev.id])
  })

  it('requires both players', async () => {
    expect((await registerFails('anon', ev.code, [person('A', 'Solo', 'a@x.co')])).message).toMatch(/2-person team/)
  })

  it('creates two players and a team entry, defaulting the team name to last names', async () => {
    const r = await register('anon', ev.code, [person('Ann', 'Ace', 'ann@x.co'), person('Bo', 'Birdie', '')])
    expect(r).toMatchObject({ status: 'confirmed', team_name: 'Ace / Birdie' })
    const teams = await db.as<{ name: string; n: number }>('anon', 'select t.name, (select count(*)::int from team_members m where m.team_id = t.id) as n from teams t where event_id = $1', [ev.id])
    expect(teams).toEqual([{ name: 'Ace / Birdie', n: 2 }])
    expect(await db.as('anon', `select id from entries where event_id = $1 and kind = 'team'`, [ev.id])).toHaveLength(1)
  })

  it('uses a chosen team name and avoids duplicates', async () => {
    const r = await register('anon', ev.code, [person('Cy', 'Chip', 'cy@x.co'), person('Di', 'Duff', 'di@x.co')], 'Ace / Birdie')
    expect(r.team_name).toBe('Ace / Birdie (2)')
  })

  it('rejects the same email twice in one team and waitlists when the field is full', async () => {
    expect((await registerFails('anon', ev.code, [person('E', 'E', 'same@x.co'), person('F', 'F', 'same@x.co')])).message).toMatch(/different email/)
    const r = await register('anon', ev.code, [person('Ed', 'Eagle', 'ed@x.co'), person('Fay', 'Fringe', 'fay@x.co')])
    expect(r.status).toBe('waitlisted')
    expect(await db.as('anon', 'select id from teams where event_id = $1', [ev.id])).toHaveLength(2)
  })

  it('cancelling a team registration removes the team and both players', async () => {
    const [reg] = await db.as<{ id: string }>(org, `select r.id from registrations r join teams t on t.id = r.team_id where t.name = 'Ace / Birdie'`)
    await db.as(org, 'select cancel_registration($1, $2)', [reg!.id, ''])
    expect(await db.as('anon', 'select id from teams where event_id = $1', [ev.id])).toHaveLength(1)
    expect(await db.as('anon', 'select id from players where event_id = $1', [ev.id])).toHaveLength(2)
  })
})

describe('admin handicap entry', () => {
  it('records index, source and date; only admins', async () => {
    const ev = await makeEvent('Hcp Event', 'stroke_individual')
    const [p] = await db.as<{ id: string }>(org, `insert into players(event_id, first_name, last_name) values ($1, 'Gil', 'Green') returning id`, [ev.id])
    await db.as(org, `select set_player_handicap($1, 8.36, 'GHIN lookup by organizer', '2026-10-01')`, [p!.id])
    const [h] = await db.as<{ handicap_index: string; source: string; as_of: string }>(org, 'select handicap_index, source, as_of::text from player_handicaps where player_id = $1', [p!.id])
    expect(h).toEqual({ handicap_index: '8.4', source: 'GHIN lookup by organizer', as_of: '2026-10-01' })
    expect((await db.fails(rando, `select set_player_handicap($1, 5, 'x', null)`, [p!.id])).code).toBe('PT403')
    expect((await db.fails(org, `select set_player_handicap($1, 5, '', null)`, [p!.id])).message).toMatch(/where this handicap came from/)
  })
})

describe('internal helpers are not exposed', () => {
  it('anon and signed-in users cannot call confirm_registration_internal', async () => {
    expect((await db.fails('anon', 'select confirm_registration_internal(gen_random_uuid())')).message).toMatch(/permission denied/)
    expect((await db.fails(org, 'select confirm_registration_internal(gen_random_uuid())')).message).toMatch(/permission denied/)
  })
})
