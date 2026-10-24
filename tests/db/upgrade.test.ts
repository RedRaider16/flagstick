// Rehearses the formats/flights/templates migration on a database that already
// holds events made under the earlier schema (like the live Test Event), so the
// upgrade is known to keep old events, scores and history intact.
import { beforeAll, describe, expect, it } from 'vitest'
import { TestDb, type TestUser } from './harness'

const UPGRADE = '20261023000000_formats_flights_templates.sql'
const PARS = [4, 4, 3, 4, 5, 3, 5, 4, 4, 4, 3, 4, 4, 5, 3, 4, 4, 5]

let db: TestDb
let org: TestUser
let indiv: { event: string; round: string; entries: string[] }
let scramble: { event: string; round: string; entry: string }

beforeAll(async () => {
  db = await TestDb.create(UPGRADE)
  org = await db.user('chris@example.com')
  await db.admin(`insert into organizers(email) values ('chris@example.com')`)
  const [course] = await db.as<{ id: string }>(org, `insert into courses(name, city) values ('Comanche Trail', 'Big Spring') returning id`)
  const [tee] = await db.as<{ id: string }>(org, `insert into tees(course_id, name) values ($1, 'Blue') returning id`, [course!.id])
  for (let i = 0; i < 18; i++)
    await db.as(org, 'insert into holes(tee_id, number, par, yardage, stroke_index) values ($1,$2,$3,$4,$5)', [tee!.id, i + 1, PARS[i], 380, i + 1])

  // A finalized individual event with full cards (like the live Test Event).
  const [e1] = await db.as<{ id: string }>(org, `select create_event('Test Event', $1, $2, '2026-10-22', 'America/Chicago', '', 'stroke_individual', 'tee_times', 'share') as id`, [course!.id, tee!.id])
  const [r1] = await db.admin<{ id: string }>('select id from rounds where event_id = $1', [e1!.id])
  for (const [f, l] of [['Ann', 'Ace'], ['Bo', 'Birdie']]) await db.as(org, 'insert into players(event_id, first_name, last_name) values ($1,$2,$3)', [e1!.id, f, l])
  const ents = await db.admin<{ id: string }>('select id from entries where event_id = $1 order by id', [e1!.id])
  const [g] = await db.as<{ id: string }>(org, `insert into groups(round_id, event_id, name, tee_time, starting_hole) values ($1,$2,'Group 1','08:00',1) returning id`, [r1!.id, e1!.id])
  for (const e of ents) await db.as(org, 'insert into group_entries(group_id, round_id, event_id, entry_id) values ($1,$2,$3,$4)', [g!.id, r1!.id, e1!.id, e.id])
  await db.as(org, `select set_event_status($1, 'published', '')`, [e1!.id])
  await db.as(org, `select set_event_status($1, 'in_progress', '')`, [e1!.id])
  for (const e of ents) for (let h = 1; h <= 18; h++) await db.as(org, 'select set_score($1,$2,$3,$4,null)', [r1!.id, e.id, h, PARS[h - 1]! + (h % 3 === 0 ? 1 : 0)])
  await db.as(org, `select finalize_round($1, 'done')`, [r1!.id])
  indiv = { event: e1!.id, round: r1!.id, entries: ents.map((x) => x.id) }

  // A two-person scramble in progress with a few team scores.
  const [e2] = await db.as<{ id: string }>(org, `select create_event('Old Scramble', $1, $2, '2026-10-30', 'America/Chicago', '', 'scramble_2', 'shotgun', 'share') as id`, [course!.id, tee!.id])
  const [r2] = await db.admin<{ id: string }>('select id from rounds where event_id = $1', [e2!.id])
  const ps: string[] = []
  for (const n of ['Cy', 'Di']) {
    const [p] = await db.as<{ id: string }>(org, 'insert into players(event_id, first_name, last_name) values ($1,$2,$3) returning id', [e2!.id, n, 'Pair'])
    ps.push(p!.id)
  }
  const [team] = await db.as<{ id: string }>(org, `insert into teams(event_id, name) values ($1, 'Pair') returning id`, [e2!.id])
  for (const p of ps) await db.as(org, 'insert into team_members(team_id, player_id, event_id) values ($1,$2,$3)', [team!.id, p, e2!.id])
  const [ent] = await db.admin<{ id: string }>('select id from entries where team_id = $1', [team!.id])
  const [g2] = await db.as<{ id: string }>(org, `insert into groups(round_id, event_id, name, starting_hole) values ($1,$2,'Hole 1',1) returning id`, [r2!.id, e2!.id])
  await db.as(org, 'insert into group_entries(group_id, round_id, event_id, entry_id) values ($1,$2,$3,$4)', [g2!.id, r2!.id, e2!.id, ent!.id])
  await db.as(org, `select set_event_status($1, 'published', '')`, [e2!.id])
  await db.as(org, `select set_event_status($1, 'in_progress', '')`, [e2!.id])
  for (let h = 1; h <= 3; h++) await db.as(org, 'select set_score($1,$2,$3,$4,null)', [r2!.id, ent!.id, h, 3])
  scramble = { event: e2!.id, round: r2!.id, entry: ent!.id }

  await db.migrate(UPGRADE)
}, 60_000)

describe('upgrading an existing database', () => {
  it('keeps old events, converting their format', async () => {
    const evs = await db.admin<{ id: string; team_size: number; status: string; cumulative: boolean; is_template: boolean }>(
      'select id, team_size, status, cumulative, is_template from events order by event_date')
    expect(evs.map((e) => [e.team_size, e.status, e.cumulative, e.is_template])).toEqual([[1, 'finalized', true, false], [2, 'in_progress', true, false]])
    const rounds = await db.admin<{ event_id: string; segments: unknown; status: string }>('select event_id, segments, status from rounds')
    expect(rounds.find((r) => r.event_id === indiv.event)).toMatchObject({ status: 'finalized', segments: [{ from: 1, to: 18, method: 'individual', count: 1 }] })
    expect(rounds.find((r) => r.event_id === scramble.event)!.segments).toEqual([{ from: 1, to: 18, method: 'scramble', count: 1 }])
  })

  it('keeps every score and the audit trail', async () => {
    const [n] = await db.admin<{ n: number; nulls: number }>(`select count(*)::int n, count(*) filter (where player_id is null)::int nulls from scores`)
    expect(n).toEqual({ n: 39, nulls: 39 })
    const [a] = await db.admin<{ n: number }>('select count(*)::int n from score_audit')
    expect(a!.n).toBe(39)
    const [done] = await db.admin<{ n: number }>('select round_holes_done($1, $2) n', [indiv.round, indiv.entries[0]])
    expect(done!.n).toBe(18)
  })

  it('old events keep working with the new functions', async () => {
    await db.as(org, 'select set_score($1,$2,$3,$4,null)', [scramble.round, scramble.entry, 4, 4])
    const [copy] = await db.as<{ id: string }>(org, `select duplicate_event($1, 'Test Event 2027', '2027-10-21', true) as id`, [indiv.event])
    const [c] = await db.admin<{ status: string; is_template: boolean; team_size: number }>('select status, is_template, team_size from events where id = $1', [copy!.id])
    expect(c).toEqual({ status: 'draft', is_template: true, team_size: 1 })
    const [cr] = await db.admin<{ n: number }>('select count(*)::int n from rounds where event_id = $1', [copy!.id])
    expect(cr!.n).toBe(1)
    const [cp] = await db.admin<{ n: number }>('select count(*)::int n from players where event_id = $1', [copy!.id])
    expect(cp!.n).toBe(0)
  })
})
