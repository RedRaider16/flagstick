import { beforeAll, describe, expect, it } from 'vitest'
import { TestDb, type TestUser } from './harness'

let db: TestDb
let org: TestUser // organizer, admin of event E1
let org2: TestUser // another organizer, admin of event E2
let sk: TestUser // scorekeeper assigned to group G1 of E1 only
let rando: TestUser // signed in, no role anywhere

interface Ev {
  event: string
  round: string
  entries: string[]
  g1: string
  g2: string
}
let e1: Ev
let e2: Ev

const PARS = [4, 4, 3, 4, 5, 3, 5, 4, 4, 4, 3, 4, 4, 5, 3, 4, 4, 5]

async function setupEvent(admin: TestUser, name: string, format: 'stroke_individual' | 'scramble_2' = 'stroke_individual'): Promise<Ev> {
  const [course] = await db.as<{ id: string }>(admin, `insert into courses(name, city) values ($1, 'Big Spring') returning id`, [`${name} CC`])
  const [tee] = await db.as<{ id: string }>(admin, `insert into tees(course_id, name) values ($1, 'White') returning id`, [course!.id])
  for (let i = 0; i < 18; i++)
    await db.as(admin, 'insert into holes(tee_id, number, par, yardage, stroke_index) values ($1,$2,$3,$4,$5)', [tee!.id, i + 1, PARS[i], 380, i + 1])
  const [ev] = await db.as<{ id: string }>(
    admin,
    `select create_event($1, $2, $3, '2026-11-07', 'America/Chicago', '', $4::int, null, 'tee_times', 'share') as id`,
    [name, course!.id, tee!.id, format === 'scramble_2' ? 2 : 1],
  )
  const event = ev!.id
  const [round] = await db.as<{ id: string }>(admin, 'select id from rounds where event_id = $1', [event])
  for (const [f, l] of [['Ann', 'Ace'], ['Bo', 'Birdie'], ['Cy', 'Chip'], ['Di', 'Duff']])
    await db.as(admin, 'insert into players(event_id, first_name, last_name) values ($1,$2,$3)', [event, f, l])
  const entries = (await db.as<{ id: string }>(admin, 'select e.id from entries e join players p on p.id = e.player_id where e.event_id = $1 order by p.last_name', [event])).map((r) => r.id)
  const [g1] = await db.as<{ id: string }>(admin, `insert into groups(round_id, event_id, name, tee_time, starting_hole) values ($1,$2,'G1','08:00',1) returning id`, [round!.id, event])
  const [g2] = await db.as<{ id: string }>(admin, `insert into groups(round_id, event_id, name, tee_time, starting_hole) values ($1,$2,'G2','08:10',10) returning id`, [round!.id, event])
  for (const [i, entry] of entries.entries())
    await db.as(admin, 'insert into group_entries(group_id, round_id, entry_id, event_id) values ($1,$2,$3,$4)', [i < 2 ? g1!.id : g2!.id, round!.id, entry, event])
  return { event, round: round!.id, entries, g1: g1!.id, g2: g2!.id }
}

const setScore = (u: TestUser | 'anon', ev: Ev, entryIdx: number, hole: number, strokes: number, expected: number | null, reason = '') =>
  db.as<{ version: number; strokes: number }>(u, 'select * from set_score($1,$2,$3,$4,$5,$6)', [ev.round, ev.entries[entryIdx], hole, strokes, expected, reason])
const failScore = (u: TestUser | 'anon', ev: Ev, entryIdx: number, hole: number, strokes: number, expected: number | null, reason = '') =>
  db.fails(u, 'select * from set_score($1,$2,$3,$4,$5,$6)', [ev.round, ev.entries[entryIdx], hole, strokes, expected, reason])

beforeAll(async () => {
  db = await TestDb.create()
  org = await db.user('chris@example.com')
  org2 = await db.user('other@example.com')
  sk = await db.user('scorer@example.com')
  rando = await db.user('rando@example.com')
  await db.admin(`insert into organizers(email) values ('chris@example.com'), ('other@example.com')`)
  e1 = await setupEvent(org, 'Fall Classic')
  e2 = await setupEvent(org2, 'Other Open')
  // Invite the scorekeeper to E1 (by email), assign G1, then they sign in and claim it.
  const [staff] = await db.as<{ id: string }>(org, `insert into event_staff(event_id, email, role) values ($1, 'scorer@example.com', 'scorekeeper') returning id`, [e1.event])
  await db.as(org, 'insert into staff_groups(staff_id, group_id, event_id) values ($1,$2,$3)', [staff!.id, e1.g1, e1.event])
  const [claimed] = await db.as<{ n: number }>(sk, 'select claim_staff_invites() as n')
  expect(claimed!.n).toBe(1)
})

describe('event creation', () => {
  it('only organizers can create courses and events', async () => {
    const r = await db.fails(rando, `insert into courses(name) values ('Sneaky') returning id`)
    expect(r.message).toMatch(/row-level security/)
    const r2 = await db.fails(rando, `select create_event('x', gen_random_uuid(), null, '2026-01-01', '', '', 1, null, 'tee_times', 'share')`)
    expect(r2.code).toBe('PT403')
  })
  it('anonymous users cannot create events', async () => {
    const r = await db.fails('anon', `select create_event('x', gen_random_uuid(), null, '2026-01-01', '', '', 1, null, 'tee_times', 'share')`)
    expect(r.message).toMatch(/permission denied/)
  })
  it('creator becomes admin and gets a 6-character public code', async () => {
    const [ev] = await db.as<{ public_code: string; status: string }>(org, 'select public_code, status from events where id = $1', [e1.event])
    expect(ev!.public_code).toMatch(/^[A-Z2-9]{6}$/)
    expect(ev!.status).toBe('draft')
    const staff = await db.as<{ role: string }>(org, 'select role from event_staff where event_id = $1 and user_id = $2', [e1.event, org.id])
    expect(staff[0]!.role).toBe('admin')
  })
  it('adding players to an individual event creates one entry each', async () => {
    expect(e1.entries).toHaveLength(4)
  })
})

describe('visibility', () => {
  it('draft events are invisible to spectators and unrelated users', async () => {
    expect(await db.as('anon', 'select id from events where id = $1', [e1.event])).toHaveLength(0)
    expect(await db.as(rando, 'select id from players where event_id = $1', [e1.event])).toHaveLength(0)
    // Staff (even a scorekeeper) can see the draft.
    expect(await db.as(sk, 'select id from events where id = $1', [e1.event])).toHaveLength(1)
  })
  it('a public code alone grants read access only after publishing — never write', async () => {
    await db.as(org, `select set_event_status($1, 'published', '')`, [e1.event])
    const [ev] = await db.as<{ public_code: string }>(org, 'select public_code from events where id = $1', [e1.event])
    expect(await db.as('anon', 'select id from events where public_code = $1', [ev!.public_code])).toHaveLength(1)
    const r = await db.fails('anon', `update events set name = 'pwned' where id = $1`, [e1.event])
    expect(r.message).toMatch(/permission denied/)
    const upd = await db.as(rando, `update players set first_name = 'X' where event_id = $1 returning id`, [e1.event])
    expect(upd).toHaveLength(0) // RLS hides the rows from non-admins
  })
  it('player contact details are admin-only', async () => {
    const [p] = await db.as<{ id: string }>(org, 'select id from players where event_id = $1 limit 1', [e1.event])
    await db.as(org, `insert into player_contacts(player_id, event_id, email, phone) values ($1, $2, 'ann@example.com', '555-123-4567')`, [p!.id, e1.event])
    expect(await db.as('anon', 'select * from player_contacts')).toHaveLength(0)
    expect(await db.as(sk, 'select * from player_contacts')).toHaveLength(0)
    expect(await db.as(org, 'select * from player_contacts')).toHaveLength(1)
  })
  it('audit and event logs are admin-only', async () => {
    expect(await db.as('anon', 'select * from event_log')).toHaveLength(0)
    expect(await db.as(sk, 'select * from event_log')).toHaveLength(0)
    expect((await db.as(org, 'select * from event_log where event_id = $1', [e1.event])).length).toBeGreaterThan(0)
  })
  it('status cannot be changed by a direct update, even by the admin', async () => {
    const r = await db.fails(org, `update events set status = 'finalized' where id = $1`, [e1.event])
    expect(r.message).toMatch(/permission denied/)
  })
  it('internal helpers like log_event are not callable from the browser', async () => {
    const r = await db.fails(org, `select log_event($1, 'fake', 'x')`, [e1.event])
    expect(r.message).toMatch(/permission denied/)
  })
})

describe('score entry permissions', () => {
  it('nobody but admins can score before the event starts', async () => {
    const r = await failScore(sk, e1, 0, 1, 4, null)
    expect(r.code).toBe('PT409')
    expect(r.message).toMatch(/not open/)
  })

  it('starting requires a ready event and is logged', async () => {
    await db.as(org, `select set_event_status($1, 'in_progress', '')`, [e1.event])
    await db.as(org2, `select set_event_status($1, 'published', '')`, [e2.event])
    await db.as(org2, `select set_event_status($1, 'in_progress', '')`, [e2.event])
    const log = await db.as<{ action: string }>(org, 'select action from event_log where event_id = $1', [e1.event])
    expect(log.map((l) => l.action)).toContain('status:published->in_progress')
  })

  it('scorekeeper can score entries in an assigned group', async () => {
    const [row] = await setScore(sk, e1, 0, 1, 4, null)
    expect(row!.strokes).toBe(4)
    expect(row!.version).toBe(1)
  })

  it('scorekeeper cannot score an unassigned group in the same event', async () => {
    const r = await failScore(sk, e1, 2, 1, 4, null)
    expect(r.code).toBe('PT403')
  })

  it("scorekeeper cannot touch another event's scores", async () => {
    const r = await db.fails(sk, 'select * from set_score($1,$2,1,4,null,$3)', [e2.round, e2.entries[0], ''])
    expect(r.code).toBe('PT403')
    // Nor smuggle another event's entry into their own round
    const r2 = await db.fails(sk, 'select * from set_score($1,$2,1,4,null,$3)', [e1.round, e2.entries[0], ''])
    expect(r2.code).toBe('PT404')
  })

  it('signed-in users with no role and anonymous users cannot score', async () => {
    expect((await failScore(rando, e1, 0, 2, 4, null)).code).toBe('PT403')
    expect((await failScore('anon', e1, 0, 2, 4, null)).message).toMatch(/permission denied/)
  })

  it('direct writes to the scores table are refused', async () => {
    const r = await db.fails(sk, `insert into scores(round_id, entry_id, event_id, hole, strokes) values ($1,$2,$3,2,4)`, [e1.round, e1.entries[0], e1.event])
    expect(r.message).toMatch(/permission denied/)
    const r2 = await db.fails(org, `delete from scores where round_id = $1`, [e1.round])
    expect(r2.message).toMatch(/permission denied/)
  })

  it('rejects invalid scores and holes at the database', async () => {
    expect((await failScore(sk, e1, 0, 3, 0, null)).code).toBe('PT400')
    expect((await failScore(sk, e1, 0, 3, 21, null)).code).toBe('PT400')
    expect((await failScore(sk, e1, 0, 19, 4, null)).code).toBe('PT400')
    const r = await db.fails(org, 'select * from set_score($1,$2,3,null,null,$3)', [e1.round, e1.entries[0], ''])
    expect(r.code).toBe('PT400')
  })

  it('spectators can read scores of a live event', async () => {
    const rows = await db.as('anon', 'select * from scores where round_id = $1', [e1.round])
    expect(rows).toHaveLength(1)
  })
})

describe('concurrent edits', () => {
  it('prevents duplicate rows when two people enter the same empty hole', async () => {
    await setScore(sk, e1, 1, 5, 5, null)
    const r = await failScore(org, e1, 1, 5, 6, null)
    expect(r.code).toBe('PT409')
    expect(r.message).toMatch(/CONFLICT/)
    expect(JSON.parse(r.detail!).current.strokes).toBe(5)
    const rows = await db.as('anon', 'select * from scores where round_id = $1 and entry_id = $2 and hole = 5', [e1.round, e1.entries[1]])
    expect(rows).toHaveLength(1)
  })

  it('rejects a stale update (lost-update protection) and bumps the version', async () => {
    const [v2] = await setScore(org, e1, 1, 5, 6, 1) // admin corrects 5 → 6
    expect(v2!.version).toBe(2)
    const r = await failScore(sk, e1, 1, 5, 4, 1) // scorekeeper still has version 1
    expect(r.code).toBe('PT409')
    const [v3] = await setScore(sk, e1, 1, 5, 4, 2) // after refreshing
    expect(v3!.version).toBe(3)
  })

  it('records every change in the audit history', async () => {
    const audit = await db.as<{ action: string; old_strokes: number | null; new_strokes: number; changed_by_email: string }>(
      org,
      'select action, old_strokes, new_strokes, changed_by_email from score_audit where round_id = $1 and entry_id = $2 and hole = 5 order by id',
      [e1.round, e1.entries[1]],
    )
    expect(audit.map((a) => [a.action, a.old_strokes, a.new_strokes, a.changed_by_email])).toEqual([
      ['insert', null, 5, 'scorer@example.com'],
      ['update', 5, 6, 'chris@example.com'],
      ['update', 6, 4, 'scorer@example.com'],
    ])
  })

  it('clearing a score removes the row (missing, not zero) and is audited', async () => {
    await db.as(sk, 'select clear_score($1,$2,5,3,$3)', [e1.round, e1.entries[1], 'wrong hole'])
    const rows = await db.as('anon', 'select * from scores where round_id = $1 and entry_id = $2 and hole = 5', [e1.round, e1.entries[1]])
    expect(rows).toHaveLength(0)
    const [last] = await db.as<{ action: string; reason: string }>(org, 'select action, reason from score_audit order by id desc limit 1')
    expect(last).toEqual({ action: 'delete', reason: 'wrong hole' })
  })
})

describe('locking, WD/DQ, finalization and reopening', () => {
  it('WD entries cannot be scored by scorekeepers', async () => {
    await db.as(org, `select set_entry_status($1, 'wd', 'injury')`, [e1.entries[1]])
    const r = await failScore(sk, e1, 1, 6, 4, null)
    expect(r.message).toMatch(/WD/)
    await db.as(org, `select set_entry_status($1, 'active', '')`, [e1.entries[1]])
  })

  it('locking blocks scorekeepers; admins must give a reason', async () => {
    await db.as(org, `select set_round_lock($1, true, 'cards in')`, [e1.round])
    expect((await failScore(sk, e1, 0, 2, 4, null)).message).toMatch(/locked/)
    expect((await failScore(org, e1, 0, 2, 4, null)).message).toMatch(/reason/)
    await setScore(org, e1, 0, 2, 4, null, 'card shows 4')
    const [last] = await db.as<{ reason: string }>(org, 'select reason from score_audit order by id desc limit 1')
    expect(last!.reason).toBe('card shows 4')
  })

  it('cannot finalize while active entries are incomplete', async () => {
    const r = await db.fails(org, `select finalize_round($1, '')`, [e1.round])
    expect(r.message).toMatch(/4 active entries are not complete/)
  })

  it('finalizes when every active entry is complete or WD/DQ', async () => {
    await db.as(org, `select set_entry_status($1, 'dq', 'wrong ball')`, [e1.entries[3]])
    for (const idx of [0, 1, 2]) {
      const have = new Set((await db.as<{ hole: number }>(org, 'select hole from scores where round_id = $1 and entry_id = $2', [e1.round, e1.entries[idx]])).map((r) => r.hole))
      for (let h = 1; h <= 18; h++) if (!have.has(h)) await setScore(org, e1, idx, h, PARS[h - 1]!, null, 'from card')
    }
    await db.as(org, `select finalize_round($1, 'all cards verified')`, [e1.round])
    const [ev] = await db.as<{ status: string }>('anon', 'select status from events where id = $1', [e1.event])
    expect(ev!.status).toBe('finalized')
  })

  it('nobody can change a finalized round — not even the admin', async () => {
    const [cur] = await db.as<{ version: number }>(org, 'select version from scores where round_id = $1 and entry_id = $2 and hole = 1', [e1.round, e1.entries[0]])
    expect((await failScore(org, e1, 0, 1, 3, cur!.version, 'oops')).message).toMatch(/final/)
    expect((await failScore(sk, e1, 0, 1, 3, cur!.version)).message).toMatch(/final/)
    expect((await db.fails(org, `select set_entry_status($1, 'active', '')`, [e1.entries[3]])).message).toMatch(/final/)
  })

  it('reopening requires a reason, is logged, and reopens as locked', async () => {
    expect((await db.fails(org, `select reopen_round($1, '')`, [e1.round])).message).toMatch(/reason/)
    expect((await db.fails(sk, `select reopen_round($1, 'x')`, [e1.round])).code).toBe('PT403')
    await db.as(org, `select reopen_round($1, 'scorecard error on 7')`, [e1.round])
    const [r] = await db.as<{ status: string }>(org, 'select status from rounds where id = $1', [e1.round])
    expect(r!.status).toBe('locked')
    const [log] = await db.as<{ action: string; detail: string; actor_email: string }>(org, 'select action, detail, actor_email from event_log where event_id = $1 order by id desc limit 1', [e1.event])
    expect(log).toEqual({ action: 'reopened', detail: 'Round 1. scorecard error on 7', actor_email: 'chris@example.com' })
    expect((await failScore(sk, e1, 0, 1, 3, 1)).message).toMatch(/locked/)
  })
})

describe('data integrity', () => {
  it('cannot delete a player who has scores', async () => {
    const [p] = await db.as<{ player_id: string }>(org, 'select player_id from entries where id = $1', [e1.entries[0]])
    const r = await db.fails(org, 'delete from players where id = $1', [p!.player_id])
    expect(r.message).toMatch(/Mark the entry WD/)
  })

  it('an entry can be in only one group per round', async () => {
    const r = await db.fails(org, 'insert into group_entries(group_id, round_id, entry_id, event_id) values ($1,$2,$3,$4)', [e1.g2, e1.round, e1.entries[0], e1.event])
    expect(r.message).toMatch(/duplicate key/)
  })

  it("an admin can't put another event's entry into their group", async () => {
    const r = await db.fails(org, 'insert into group_entries(group_id, round_id, entry_id, event_id) values ($1,$2,$3,$4)', [e1.g2, e1.round, e2.entries[0], e1.event])
    expect(r.message).toMatch(/foreign key|row-level security/)
  })

  it('format change is blocked once scores exist', async () => {
    const r = await db.fails(org, `update events set team_size = 2 where id = (select event_id from rounds where id = $1)`, [e1.round])
    expect(r.message).toMatch(/team size can't change/)
  })
})

describe('two-person scramble', () => {
  let ev: Ev
  it('teams become entries and are limited to two players', async () => {
    ev = await setupEvent(org, 'Scramble Day', 'scramble_2')
    expect(ev.entries).toHaveLength(0) // players alone are not entries in a scramble
    const players = (await db.as<{ id: string }>(org, 'select id from players where event_id = $1 order by last_name', [ev.event])).map((p) => p.id)
    const [team] = await db.as<{ id: string }>(org, `insert into teams(event_id, name) values ($1, 'Eagles') returning id`, [ev.event])
    await db.as(org, 'insert into team_members(team_id, player_id, event_id) values ($1,$2,$3),($1,$4,$3)', [team!.id, players[0], ev.event, players[1]])
    const r = await db.fails(org, 'insert into team_members(team_id, player_id, event_id) values ($1,$2,$3)', [team!.id, players[2], ev.event])
    expect(r.message).toMatch(/at most 2 players/)
    const entries = await db.as<{ kind: string }>(org, 'select kind from entries where event_id = $1', [ev.event])
    expect(entries).toEqual([{ kind: 'team' }])
  })

  it('a player cannot be on two teams', async () => {
    const [p] = await db.as<{ id: string }>(org, `select id from players where event_id = $1 and last_name = 'Ace'`, [ev.event])
    const [t2] = await db.as<{ id: string }>(org, `insert into teams(event_id, name) values ($1, 'Hawks') returning id`, [ev.event])
    const r = await db.fails(org, 'insert into team_members(team_id, player_id, event_id) values ($1,$2,$3)', [t2!.id, p!.id, ev.event])
    expect(r.message).toMatch(/duplicate key/)
  })

  it('cannot start while a team does not have exactly two players', async () => {
    await db.as(org, `select set_event_status($1, 'published', '')`, [ev.event])
    const r = await db.fails(org, `select set_event_status($1, 'in_progress', '')`, [ev.event])
    expect(r.message).toMatch(/at least 2 players/)
  })
})
