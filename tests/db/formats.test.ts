// Team sizes, per-hole formats (segments), per-player best-ball scores, flights,
// multi-round events, DNF/NS, per-player tees, templates and duplicate_event.
import { beforeAll, describe, expect, it } from 'vitest'
import { TestDb, type TestUser } from './harness'

let db: TestDb
let org: TestUser
let other: TestUser
let course: string
let blue: string
let gold: string
const PARS = [4, 4, 3, 4, 5, 3, 5, 4, 4, 4, 3, 4, 4, 5, 3, 4, 4, 5]

const seg = (...s: [number, number, string, number?][]) =>
  JSON.stringify(s.map(([from, to, method, count]) => ({ from, to, method, count: count ?? 1 })))
const BEST2 = seg([1, 18, 'best_ball', 2])
const SIX = seg([1, 6, 'scramble'], [7, 12, 'alt_shot'], [13, 18, 'best_ball', 1])

async function event(name: string, size: number, segments: string | null, date = '2027-04-17') {
  const [ev] = await db.as<{ id: string }>(org,
    `select create_event($1,$2,$3,$4,'America/Chicago','',$5::int,$6::jsonb,'shotgun','share') as id`,
    [name, course, blue, date, size, segments])
  const [r] = await db.as<{ id: string }>(org, 'select id from rounds where event_id = $1', [ev!.id])
  return { id: ev!.id, round: r!.id }
}

async function team(eventId: string, name: string, names: string[]) {
  const [t] = await db.as<{ id: string }>(org, 'insert into teams(event_id, name) values ($1,$2) returning id', [eventId, name])
  const ids: string[] = []
  for (const n of names) {
    const [p] = await db.as<{ id: string }>(org, `insert into players(event_id, first_name, last_name) values ($1,$2,'X') returning id`, [eventId, n])
    await db.as(org, 'insert into team_members(team_id, player_id, event_id) values ($1,$2,$3)', [t!.id, p!.id, eventId])
    ids.push(p!.id)
  }
  const [e] = await db.as<{ id: string }>(org, 'select id from entries where team_id = $1', [t!.id])
  return { team: t!.id, entry: e!.id, players: ids }
}

beforeAll(async () => {
  db = await TestDb.create()
  org = await db.user('chris@example.com')
  other = await db.user('other@example.com')
  await db.admin(`insert into organizers(email) values ('chris@example.com'), ('other@example.com')`)
  const [c] = await db.as<{ id: string }>(org, `insert into courses(name, city) values ('Comanche Trail','Big Spring') returning id`)
  course = c!.id
  for (const name of ['Blue', 'Gold']) {
    const [t] = await db.as<{ id: string }>(org, 'insert into tees(course_id, name) values ($1,$2) returning id', [course, name])
    for (let i = 0; i < 18; i++)
      await db.as(org, 'insert into holes(tee_id, number, par, yardage, stroke_index) values ($1,$2,$3,$4,$5)', [t!.id, i + 1, PARS[i], 380, i + 1])
    if (name === 'Blue') blue = t!.id
    else gold = t!.id
  }
})

describe('round formats', () => {
  it('rejects segments that do not cover 1–18 or do not suit the team size', async () => {
    const gap = seg([1, 9, 'scramble'], [11, 18, 'scramble'])
    expect((await db.fails(org, `select create_event('x',$1,$2,'2027-01-01','','',2,$3::jsonb,'shotgun','share')`, [course, blue, gap])).message).toMatch(/cover holes 1–18/)
    expect((await db.fails(org, `select create_event('x',$1,$2,'2027-01-01','','',1,$3::jsonb,'shotgun','share')`, [course, blue, BEST2])).message).toMatch(/Individual events/)
    const four = seg([1, 18, 'best_ball', 4])
    expect((await db.fails(org, `select create_event('x',$1,$2,'2027-01-01','','',3,$3::jsonb,'shotgun','share')`, [course, blue, four])).message).toMatch(/between 1 and 3/)
  })

  it('limits teams to the event team size', async () => {
    const ev = await event('Three Man', 3, BEST2)
    const t = await team(ev.id, 'Trio', ['A', 'B', 'C'])
    const [p] = await db.as<{ id: string }>(org, `insert into players(event_id, first_name, last_name) values ($1,'D','X') returning id`, [ev.id])
    const r = await db.fails(org, 'insert into team_members(team_id, player_id, event_id) values ($1,$2,$3)', [t.team, p!.id, ev.id])
    expect(r.message).toMatch(/at most 3 players/)
  })
})

describe('best ball scores', () => {
  let ev: { id: string; round: string }
  let t: Awaited<ReturnType<typeof team>>
  beforeAll(async () => {
    ev = await event('Jimmy Roger', 3, BEST2)
    t = await team(ev.id, 'Trio', ['A', 'B', 'C'])
    await db.as(org, `select set_event_status($1,'published')`, [ev.id])
  })

  it('needs a player on best-ball holes and the player must be on the team', async () => {
    expect((await db.fails(org, 'select * from set_score($1,$2,1,4,null,$3)', [ev.round, t.entry, ''])).message).toMatch(/best ball: enter each player/)
    const [p] = await db.as<{ id: string }>(org, `insert into players(event_id, first_name, last_name) values ($1,'Z','Z') returning id`, [ev.id])
    expect((await db.fails(org, 'select * from set_score($1,$2,1,4,null,$3,$4)', [ev.round, t.entry, '', p!.id])).message).toMatch(/isn't on this team/)
  })

  it('stores one score per player per hole with its own version', async () => {
    const [a] = await db.as<{ version: number }>(org, 'select * from set_score($1,$2,1,4,null,$3,$4)', [ev.round, t.entry, '', t.players[0]])
    const [b] = await db.as<{ version: number }>(org, 'select * from set_score($1,$2,1,5,null,$3,$4)', [ev.round, t.entry, '', t.players[1]])
    expect(a!.version).toBe(1)
    expect(b!.version).toBe(1)
    const [a2] = await db.as<{ version: number }>(org, 'select * from set_score($1,$2,1,3,1,$3,$4)', [ev.round, t.entry, 'fix', t.players[0]])
    expect(a2!.version).toBe(2)
    const conflict = await db.fails(org, 'select * from set_score($1,$2,1,6,1,$3,$4)', [ev.round, t.entry, '', t.players[0]])
    expect(conflict.code).toBe('PT409')
    const [audit] = await db.admin<{ player_id: string }>(`select player_id from score_audit where entry_id = $1 and action = 'update'`, [t.entry])
    expect(audit!.player_id).toBe(t.players[0])
  })

  it('counts a best-2 hole as done only with two player scores', async () => {
    const [{ n }] = (await db.admin<{ n: number }>('select round_holes_done($1,$2) as n', [ev.round, t.entry])) as [{ n: number }]
    expect(n).toBe(1)
    await db.as(org, 'select * from set_score($1,$2,2,4,null,$3,$4)', [ev.round, t.entry, '', t.players[2]])
    const [{ n: n2 }] = (await db.admin<{ n: number }>('select round_holes_done($1,$2) as n', [ev.round, t.entry])) as [{ n: number }]
    expect(n2).toBe(1)
  })

  it('format and team size are frozen once scores exist', async () => {
    expect((await db.fails(org, `update rounds set segments = $2::jsonb where id = $1`, [ev.round, seg([1, 18, 'scramble'])])).message).toMatch(/format can't change/)
    expect((await db.fails(org, `update events set team_size = 4 where id = $1`, [ev.id])).message).toMatch(/team size can't change/)
  })
})

describe('the 666', () => {
  it('takes team scores on scramble and alternate-shot holes, player scores on best-ball holes', async () => {
    const ev = await event('CTMGA 666', 2, SIX)
    const t = await team(ev.id, 'Pair', ['A', 'B'])
    await db.as(org, `select set_event_status($1,'published')`, [ev.id])
    await db.as(org, 'select * from set_score($1,$2,3,4,null,$3)', [ev.round, t.entry, ''])
    await db.as(org, 'select * from set_score($1,$2,8,4,null,$3)', [ev.round, t.entry, ''])
    expect((await db.fails(org, 'select * from set_score($1,$2,8,4,null,$3,$4)', [ev.round, t.entry, '', t.players[0]])).message).toMatch(/one score for the team/)
    await db.as(org, 'select * from set_score($1,$2,14,4,null,$3,$4)', [ev.round, t.entry, '', t.players[1]])
    const [{ n }] = (await db.admin<{ n: number }>('select round_holes_done($1,$2) as n', [ev.round, t.entry])) as [{ n: number }]
    expect(n).toBe(3)
  })
})

describe('team size changes', () => {
  it('rebuilds entries and resets formats that no longer fit', async () => {
    const ev = await event('Switcher', 1, null)
    await db.as(org, `insert into players(event_id, first_name, last_name) values ($1,'A','A'), ($1,'B','B')`, [ev.id])
    expect((await db.admin('select 1 from entries where event_id = $1', [ev.id])).length).toBe(2)
    await db.as(org, 'update events set team_size = 4 where id = $1', [ev.id])
    expect((await db.admin('select 1 from entries where event_id = $1', [ev.id])).length).toBe(0)
    const [r] = await db.admin<{ segments: { method: string }[] }>('select segments from rounds where id = $1', [ev.round])
    expect(r!.segments[0]!.method).toBe('scramble')
  })
})

describe('multi-round events, flights and statuses', () => {
  let ev: { id: string; round: string }
  let r2: string
  let a: Awaited<ReturnType<typeof team>>
  let b: Awaited<ReturnType<typeof team>>
  beforeAll(async () => {
    ev = await event('United Way', 4, null, '2027-08-21')
    a = await team(ev.id, 'Alpha', ['A', 'B', 'C', 'D'])
    b = await team(ev.id, 'Bravo', ['E', 'F', 'G', 'H'])
  })

  it('adds a round the next day with the same setup, and removes it again', async () => {
    const [x] = await db.as<{ id: string }>(org, 'select add_round($1) as id', [ev.id])
    const [row] = await db.admin<{ round_number: number; round_date: string }>(`select round_number, round_date::text from rounds where id = $1`, [x!.id])
    expect(row).toEqual({ round_number: 2, round_date: '2027-08-22' })
    const [y] = await db.as<{ id: string }>(org, 'select add_round($1) as id', [ev.id])
    await db.as(org, 'select delete_round($1)', [x!.id])
    const [renum] = await db.admin<{ round_number: number }>('select round_number from rounds where id = $1', [y!.id])
    expect(renum!.round_number).toBe(2)
    r2 = y!.id
    expect((await db.fails(other, 'select add_round($1)', [ev.id])).code).toBe('PT403')
  })

  it('assigns flights in bulk; only admins, only this event’s flights', async () => {
    const [champ] = await db.as<{ id: string }>(org, `insert into flights(event_id, name, sort_order) values ($1,'Championship',1) returning id`, [ev.id])
    await db.as(org, `insert into flights(event_id, name, sort_order) values ($1,'Presidents',2)`, [ev.id])
    await db.as(org, 'select set_entry_flights($1,$2::jsonb)', [ev.id, JSON.stringify([{ entry_id: a.entry, flight_id: champ!.id }, { entry_id: b.entry, flight_id: null }])])
    const rows = await db.admin<{ flight_id: string | null }>('select flight_id from entries where event_id = $1 order by flight_id nulls last', [ev.id])
    expect(rows.map((r) => r.flight_id)).toEqual([champ!.id, null])
    expect((await db.fails(other, 'select set_entry_flights($1,$2::jsonb)', [ev.id, '[]'])).code).toBe('PT403')
    const ev2 = await event('Elsewhere', 1, null)
    const [f2] = await db.as<{ id: string }>(org, `insert into flights(event_id, name) values ($1,'Other') returning id`, [ev2.id])
    expect((await db.fails(org, 'select set_entry_flights($1,$2::jsonb)', [ev.id, JSON.stringify([{ entry_id: a.entry, flight_id: f2!.id }])])).message).toMatch(/Unknown flight/)
    // Deleting a flight leaves the entry in no flight.
    await db.as(org, 'delete from flights where id = $1', [champ!.id])
    const [after] = await db.admin<{ flight_id: string | null }>('select flight_id from entries where id = $1', [a.entry])
    expect(after!.flight_id).toBeNull()
  })

  it('finalizes round by round; NS entries do not block; the event is final after the last round', async () => {
    await db.as(org, `select set_event_status($1,'published')`, [ev.id])
    await db.as(org, `select set_event_status($1,'in_progress')`, [ev.id])
    for (let h = 1; h <= 18; h++) {
      await db.as(org, 'select * from set_score($1,$2,$3,4,null,$4)', [ev.round, a.entry, h, ''])
      await db.as(org, 'select * from set_score($1,$2,$3,4,null,$4)', [ev.round, b.entry, h, ''])
    }
    await db.as(org, 'select finalize_round($1)', [ev.round])
    const [mid] = await db.admin<{ status: string }>('select status from events where id = $1', [ev.id])
    expect(mid!.status).toBe('in_progress')
    for (let h = 1; h <= 18; h++) await db.as(org, 'select * from set_score($1,$2,$3,4,null,$4)', [r2, a.entry, h, ''])
    expect((await db.fails(org, 'select finalize_round($1)', [r2])).message).toMatch(/WD, DNF or NS/)
    await db.as(org, `select set_entry_status($1,'ns','no show Sunday')`, [b.entry])
    await db.as(org, 'select finalize_round($1)', [r2])
    const [end] = await db.admin<{ status: string }>('select status from events where id = $1', [ev.id])
    expect(end!.status).toBe('finalized')
  })
})

describe('per-player tees', () => {
  it('accepts a tee on the event course only', async () => {
    const ev = await event('City Championship', 1, null)
    const [p] = await db.as<{ id: string }>(org, `insert into players(event_id, first_name, last_name, tee_id) values ($1,'Lady','Golfer',$2) returning id`, [ev.id, gold])
    expect(p!.id).toBeTruthy()
    const [c2] = await db.as<{ id: string }>(org, `insert into courses(name, city) values ('Elsewhere','Midland') returning id`)
    const [t2] = await db.as<{ id: string }>(org, `insert into tees(course_id, name) values ($1,'Blue') returning id`, [c2!.id])
    expect((await db.fails(org, 'update players set tee_id = $2 where id = $1', [p!.id, t2!.id])).message).toMatch(/isn't on this event's course/)
  })
})

describe('templates and duplicating', () => {
  let src: { id: string; round: string }
  beforeAll(async () => {
    src = await event('2026 Jimmy Roger Showdown', 3, BEST2, '2026-04-18')
    await db.as(org, 'select add_round($1)', [src.id])
    await db.as(org, `insert into flights(event_id, name, sort_order) values ($1,'Championship',1), ($1,'Presidents',2)`, [src.id])
    await db.as(org, `update events set entry_fee_cents = 30000, max_players = 135, registration_closes_at = '2026-04-15T23:00:00Z' where id = $1`, [src.id])
    await team(src.id, 'Old team', ['A', 'B', 'C'])
  })

  it('copies format, rounds (dates shifted), flights and fees, but no players', async () => {
    const [n] = await db.as<{ id: string }>(org, `select duplicate_event($1,'2027 Jimmy Roger Showdown','2027-04-17') as id`, [src.id])
    const [e] = await db.admin<Record<string, unknown>>(
      `select status, team_size, entry_fee_cents, max_players, registration_open, registration_closes_at::date::text as closes, is_template from events where id = $1`, [n!.id])
    expect(e).toEqual({ status: 'draft', team_size: 3, entry_fee_cents: 30000, max_players: 135, registration_open: false, closes: '2027-04-14', is_template: false })
    const rounds = await db.admin<{ round_number: number; d: string; segments: unknown }>(`select round_number, round_date::text as d, segments from rounds where event_id = $1 order by round_number`, [n!.id])
    expect(rounds.map((r) => [r.round_number, r.d])).toEqual([[1, '2027-04-17'], [2, '2027-04-18']])
    expect(rounds[0]!.segments).toEqual(JSON.parse(BEST2))
    expect((await db.admin('select name from flights where event_id = $1 order by sort_order', [n!.id])).map((r) => r.name)).toEqual(['Championship', 'Presidents'])
    expect((await db.admin('select 1 from players where event_id = $1', [n!.id])).length).toBe(0)
    const [staff] = await db.admin<{ email: string; role: string }>('select email, role from event_staff where event_id = $1', [n!.id])
    expect(staff).toEqual({ email: 'chris@example.com', role: 'admin' })
  })

  it('templates stay drafts; non-admins cannot copy', async () => {
    const [tpl] = await db.as<{ id: string }>(org, `select duplicate_event($1,'Jimmy Roger Showdown','2026-04-18',true) as id`, [src.id])
    expect((await db.fails(org, `select set_event_status($1,'published')`, [tpl!.id])).message).toMatch(/template/)
    expect((await db.fails(other, `select duplicate_event($1,'Mine','2027-04-17')`, [src.id])).code).toBe('PT403')
    expect((await db.as<{ id: string }>('anon', 'select id from events where id = $1', [tpl!.id])).length).toBe(0)
  })
})

describe('registration by team size', () => {
  it('takes four players for a four-person event', async () => {
    const ev = await event('Four Ball Fun', 4, null)
    await db.as(org, 'update events set registration_open = true where id = $1', [ev.id])
    await db.as(org, `select set_event_status($1,'published')`, [ev.id])
    const [{ public_code: code }] = (await db.admin<{ public_code: string }>('select public_code from events where id = $1', [ev.id])) as [{ public_code: string }]
    const people = ['A', 'B', 'C', 'D'].map((n, i) => ({ first_name: n, last_name: 'Q', email: i === 0 ? 'lead@x.co' : '', phone: '', handicap_index: '' }))
    expect((await db.fails('anon', 'select register_for_event($1,$2::jsonb)', [code, JSON.stringify(people.slice(0, 2))])).message).toMatch(/4-person team event/)
    const [res] = await db.as<{ r: { status: string; team_name: string } }>('anon', `select register_for_event($1,$2::jsonb,'Fearsome Four') as r`, [code, JSON.stringify(people)])
    expect(res!.r.status).toBe('confirmed')
    const [{ n }] = (await db.admin<{ n: number }>('select count(*)::int as n from team_members m join teams t on t.id = m.team_id where t.event_id = $1', [ev.id])) as [{ n: number }]
    expect(n).toBe(4)
  })
})
