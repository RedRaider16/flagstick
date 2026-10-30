import { beforeAll, describe, expect, it } from 'vitest'
import { TestDb, type TestUser } from './harness'

// Scorecard QR codes: a card's code lets anyone holding it score that group, and nothing more.

let db: TestDb
let org: TestUser
let other: TestUser
let ev: { event: string; round: string; entries: string[]; g1: string; g2: string }
let codes: Map<string, string>

const PARS = [4, 4, 3, 4, 5, 3, 5, 4, 4, 4, 3, 4, 4, 5, 3, 4, 4, 5]
const setByCard = (token: string, entry: string, hole: number, strokes: number, expected: number | null) =>
  db.as<{ version: number; strokes: number; updated_by: string | null }>('anon', 'select * from card_set_score($1,$2,$3,$4,$5)', [token, entry, hole, strokes, expected])
const failByCard = (token: string, entry: string, hole: number, strokes: number, expected: number | null) =>
  db.fails('anon', 'select * from card_set_score($1,$2,$3,$4,$5)', [token, entry, hole, strokes, expected])

beforeAll(async () => {
  db = await TestDb.create()
  org = await db.user('chris@example.com')
  other = await db.user('other@example.com')
  await db.admin(`insert into organizers(email) values ('chris@example.com'), ('other@example.com')`)
  const [course] = await db.as<{ id: string }>(org, `insert into courses(name, city) values ('Comanche Trail', 'Big Spring') returning id`)
  const [tee] = await db.as<{ id: string }>(org, `insert into tees(course_id, name) values ($1, 'Blue') returning id`, [course!.id])
  for (let i = 0; i < 18; i++)
    await db.as(org, 'insert into holes(tee_id, number, par, yardage, stroke_index) values ($1,$2,$3,$4,$5)', [tee!.id, i + 1, PARS[i], 380, i + 1])
  const [e] = await db.as<{ id: string }>(org, `select create_event('Card Open', $1, $2, '2026-11-07', 'America/Chicago', '', 1, null, 'tee_times', 'share') as id`, [course!.id, tee!.id])
  const event = e!.id
  const [round] = await db.as<{ id: string }>(org, 'select id from rounds where event_id = $1', [event])
  for (const [f, l] of [['Ann', 'Ace'], ['Bo', 'Birdie'], ['Cy', 'Chip']])
    await db.as(org, 'insert into players(event_id, first_name, last_name) values ($1,$2,$3)', [event, f, l])
  const entries = (await db.as<{ id: string }>(org, 'select e.id from entries e join players p on p.id = e.player_id where e.event_id = $1 order by p.last_name', [event])).map((r) => r.id)
  const [g1] = await db.as<{ id: string }>(org, `insert into groups(round_id, event_id, name, tee_time) values ($1,$2,'Group 1','08:00') returning id`, [round!.id, event])
  const [g2] = await db.as<{ id: string }>(org, `insert into groups(round_id, event_id, name, tee_time) values ($1,$2,'Group 2','08:10') returning id`, [round!.id, event])
  for (const [i, entry] of entries.entries())
    await db.as(org, 'insert into group_entries(group_id, round_id, entry_id, event_id) values ($1,$2,$3,$4)', [i < 2 ? g1!.id : g2!.id, round!.id, entry, event])
  ev = { event, round: round!.id, entries, g1: g1!.id, g2: g2!.id }
})

describe('scorecard codes', () => {
  it('only an event admin can get the codes', async () => {
    expect((await db.fails('anon', 'select * from scoring_card_codes($1)', [ev.round])).code).toBe('42501')
    expect((await db.fails(other, 'select * from scoring_card_codes($1)', [ev.round])).code).toBe('PT403')
    const rows = await db.as<{ group_id: string; token: string }>(org, 'select * from scoring_card_codes($1)', [ev.round])
    codes = new Map(rows.map((r) => [r.group_id, r.token]))
    expect(codes.size).toBe(2)
    // Printing again gives the same codes.
    const again = await db.as<{ group_id: string; token: string }>(org, 'select * from scoring_card_codes($1)', [ev.round])
    expect(new Map(again.map((r) => [r.group_id, r.token]))).toEqual(codes)
  })

  it('no client can read the codes table directly', async () => {
    expect((await db.fails('anon', 'select * from scoring_cards')).code).toBe('42501')
    expect((await db.fails(org, 'select * from scoring_cards')).code).toBe('42501')
  })

  it('a code does nothing until the event is published, then only tells which group it is', async () => {
    expect(await db.as('anon', 'select * from scoring_card($1)', [codes.get(ev.g1)])).toEqual([])
    expect((await failByCard(codes.get(ev.g1)!, ev.entries[0]!, 1, 4, null)).message).toMatch(/not open/)
    await db.as(org, `select set_event_status($1, 'published', '')`, [ev.event])
    expect(await db.as('anon', 'select * from scoring_card($1)', [codes.get(ev.g1)])).toEqual([{ event_id: ev.event, round_id: ev.round, group_id: ev.g1 }])
    expect(await db.as('anon', 'select * from scoring_card($1)', ['0'.repeat(32)])).toEqual([])
    expect((await failByCard(codes.get(ev.g1)!, ev.entries[0]!, 1, 4, null)).message).toMatch(/not open/)
  })

  it('scores its own group without signing in, with the usual conflict check', async () => {
    await db.as(org, `select set_event_status($1, 'in_progress', '')`, [ev.event])
    const [s] = await setByCard(codes.get(ev.g1)!, ev.entries[1]!, 1, 5, null)
    expect(s).toMatchObject({ strokes: 5, version: 1, updated_by: null })
    expect((await failByCard(codes.get(ev.g1)!, ev.entries[1]!, 1, 4, null)).code).toBe('PT409')
    const [s2] = await setByCard(codes.get(ev.g1)!, ev.entries[1]!, 1, 4, 1)
    expect(s2!.version).toBe(2)
    const [audit] = await db.admin<{ changed_by_email: string }>('select changed_by_email from score_audit where entry_id = $1 order by id desc limit 1', [ev.entries[1]])
    expect(audit!.changed_by_email).toBe('Scorecard QR, Group 1')
  })

  it("can't score another group's entries", async () => {
    expect((await failByCard(codes.get(ev.g1)!, ev.entries[2]!, 1, 4, null)).message).toMatch(/isn't on this scorecard/)
  })

  it('stops for a withdrawn entry and a locked round', async () => {
    await db.as(org, `select set_entry_status($1, 'wd', 'left early')`, [ev.entries[0]])
    expect((await failByCard(codes.get(ev.g1)!, ev.entries[0]!, 2, 4, null)).message).toMatch(/WD/)
    await db.as(org, `select set_entry_status($1, 'active', '')`, [ev.entries[0]])
    await db.as(org, `select set_round_lock($1, true, 'checking cards')`, [ev.round])
    expect((await failByCard(codes.get(ev.g1)!, ev.entries[0]!, 2, 4, null)).message).toMatch(/locked/)
    await db.as(org, `select set_round_lock($1, false, '')`, [ev.round])
  })

  it('clears a hole; a missing score stays missing', async () => {
    await db.as('anon', 'select card_clear_score($1,$2,$3,$4)', [codes.get(ev.g1), ev.entries[1], 1, 2])
    expect(await db.admin('select 1 from scores where entry_id = $1 and hole = 1', [ev.entries[1]])).toEqual([])
  })

  it('reset cancels the old codes', async () => {
    expect((await db.fails(other, 'select reset_scoring_cards($1)', [ev.round])).code).toBe('PT403')
    await db.as(org, 'select reset_scoring_cards($1)', [ev.round])
    expect((await failByCard(codes.get(ev.g1)!, ev.entries[0]!, 3, 4, null)).message).toMatch(/isn't valid/)
    const fresh = await db.as<{ group_id: string; token: string }>(org, 'select * from scoring_card_codes($1)', [ev.round])
    expect(fresh.find((r) => r.group_id === ev.g1)!.token).not.toBe(codes.get(ev.g1))
  })

  it('the codes table has no way in for the Supabase client roles', async () => {
    const rows = await db.admin<{ grantee: string }>(`select grantee from information_schema.role_table_grants where table_name = 'scoring_cards' and grantee in ('anon','authenticated')`)
    expect(rows).toEqual([])
  })
})

describe('no-show / did-not-finish for one round', () => {
  it('only admins set it; everyone who can see the event can read it', async () => {
    const fresh = await db.as<{ group_id: string; token: string }>(org, 'select * from scoring_card_codes($1)', [ev.round])
    codes = new Map(fresh.map((r) => [r.group_id, r.token]))
    expect((await db.fails(other, `select set_round_entry_status($1, $2, 'ns', '')`, [ev.round, ev.entries[0]])).code).toBe('PT403')
    expect((await db.fails('anon', `select set_round_entry_status($1, $2, 'ns', '')`, [ev.round, ev.entries[0]])).code).toBe('42501')
    expect((await db.fails(org, `select set_round_entry_status($1, $2, 'wd', '')`, [ev.round, ev.entries[0]])).code).toBe('PT409')
    await db.as(org, `select set_round_entry_status($1, $2, 'ns', 'did not show sunday')`, [ev.round, ev.entries[0]])
    expect(await db.as('anon', 'select status, note from round_entry_status where entry_id = $1', [ev.entries[0]])).toEqual([{ status: 'ns', note: 'did not show sunday' }])
    expect((await db.fails('anon', `insert into round_entry_status(round_id, entry_id, event_id, status) values ($1,$2,$3,'dnf')`, [ev.round, ev.entries[1], ev.event])).code).toBe('42501')
  })

  it('blocks scoring that entry in that round from a card, but an admin can still correct it', async () => {
    expect((await failByCard(codes.get(ev.g1)!, ev.entries[0]!, 9, 4, null)).message).toMatch(/marked NS for this round/)
    const [s] = await db.as<{ strokes: number }>(org, 'select * from set_score($1,$2,9,4,null,$3)', [ev.round, ev.entries[0], ''])
    expect(s!.strokes).toBe(4)
    await db.as(org, 'select set_round_entry_status($1, $2, null, $3)', [ev.round, ev.entries[0], 'showed up late'])
    const [again] = await setByCard(codes.get(ev.g1)!, ev.entries[0]!, 10, 5, null)
    expect(again!.strokes).toBe(5)
    expect(await db.as('anon', 'select 1 from round_entry_status where entry_id = $1', [ev.entries[0]])).toEqual([])
  })
})
