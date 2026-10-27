import { beforeAll, describe, expect, it } from 'vitest'
import { TestDb, type TestUser } from './harness'

// Confirmation emails are queued with the registration change, in the same transaction.

let db: TestDb
let org: TestUser
let other: TestUser
let ev: { id: string; code: string }
const PARS = [4, 4, 3, 4, 5, 3, 5, 4, 4, 4, 3, 4, 4, 5, 3, 4, 4, 5]

interface Mail { kind: string; to_email: string; subject: string; body: string; status: string }
const outbox = (ref?: string) =>
  db.admin<Mail & { ref: string }>(`select o.kind, o.to_email, o.subject, o.body, o.status, r.ref from email_outbox o join registrations r on r.id = o.registration_id
    where o.event_id = $1 ${ref ? 'and r.ref = $2' : ''} order by o.created_at, o.to_email`, ref ? [ev.id, ref] : [ev.id])
const person = (first: string, last: string, email = '') => ({ first_name: first, last_name: last, email, phone: '' })
const register = async (people: unknown[], team = '') =>
  (await db.as<{ r: { status: string; ref: string } }>('anon', 'select register_for_event($1, $2::jsonb, $3, $4) as r', [ev.code, JSON.stringify(people), team, '']))[0]!.r

beforeAll(async () => {
  db = await TestDb.create()
  org = await db.user('chris@example.com')
  other = await db.user('other@example.com')
  await db.admin(`insert into organizers(email) values ('chris@example.com'), ('other@example.com')`)
  const [course] = await db.as<{ id: string }>(org, `insert into courses(name) values ('Comanche Trail') returning id`)
  const [tee] = await db.as<{ id: string }>(org, `insert into tees(course_id, name) values ($1, 'Blue') returning id`, [course!.id])
  for (let i = 0; i < 18; i++)
    await db.as(org, 'insert into holes(tee_id, number, par, yardage, stroke_index) values ($1,$2,$3,380,$4)', [tee!.id, i + 1, PARS[i], i + 1])
  const [e] = await db.as<{ id: string }>(org, `select create_event('Best of the Rest', $1, $2, '2027-10-16', 'America/Chicago', '', 2, null, 'tee_times', 'share') as id`, [course!.id, tee!.id])
  await db.as(org, `update events set registration_open = true, max_players = 4, waitlist_limit = 10, entry_fee_cents = 20000, payment_instructions = 'Pay at the pro shop.' where id = $1`, [e!.id])
  await db.as(org, `select set_event_status($1, 'published', '')`, [e!.id])
  const [row] = await db.admin<{ public_code: string }>('select public_code from events where id = $1', [e!.id])
  ev = { id: e!.id, code: row!.public_code }
})

describe('confirmation emails', () => {
  it('a team sign-up queues one message per player with an email, with the details', async () => {
    const r = await register([person('Kirk', 'Noyes', 'kirk@example.com'), person('Jay', 'McLeod')], 'Noyes/McLeod')
    const mails = await outbox(r.ref)
    expect(mails.map((m) => [m.kind, m.to_email, m.status])).toEqual([['registered', 'kirk@example.com', 'pending']])
    const m = mails[0]!
    expect(m.subject).toBe("You're registered: Best of the Rest")
    expect(m.body).toContain('Hi Kirk,')
    expect(m.body).toContain(`Confirmation number: ${r.ref}`)
    expect(m.body).toContain('Team: Noyes/McLeod')
    expect(m.body).toContain('Players: Kirk Noyes, Jay McLeod')
    expect(m.body).toContain('Saturday, October 16, 2027')
    expect(m.body).toContain('Entry fee: $200 per player ($400 per team).\nPay at the pro shop.')
    expect(m.body).toContain(`/e/${ev.code}`)
  })

  it('a full field puts the next team on the waitlist; moving them up sends "you\'re in"', async () => {
    await register([person('A', 'One', 'a1@example.com'), person('B', 'One', 'b1@example.com')], 'Team One')
    const w = await register([person('C', 'Two', 'c2@example.com'), person('D', 'Two')], 'Team Two')
    expect(w.status).toBe('waitlisted')
    expect((await outbox(w.ref)).map((m) => [m.kind, m.to_email])).toEqual([['waitlisted', 'c2@example.com']])
    const [reg] = await db.admin<{ id: string }>('select id from registrations where ref = $1', [w.ref])
    await db.as(org, `update events set max_players = 6 where id = $1`, [ev.id])
    await db.as(org, 'select promote_registration($1)', [reg!.id])
    const after = await outbox(w.ref)
    expect(after.map((m) => m.kind)).toEqual(['waitlisted', 'promoted'])
    expect(after[1]!.subject).toMatch(/You're in/)
    expect(after[1]!.body).toContain('Entry fee')
  })

  it('cancelling sends a cancellation without the fee or link', async () => {
    const r = await register([person('E', 'Three', 'e3@example.com'), person('F', 'Three')], 'Team Three')
    const [reg] = await db.admin<{ id: string }>('select id from registrations where ref = $1', [r.ref])
    await db.as(org, 'select cancel_registration($1, $2)', [reg!.id, 'changed plans'])
    const c = (await outbox(r.ref)).find((m) => m.kind === 'cancelled')!
    expect(c.body).toContain('has been cancelled')
    expect(c.body).not.toContain('Entry fee')
    expect(c.body).not.toContain('/e/')
  })

  it('only that event\'s admins can read its emails or send one again; players and the public cannot', async () => {
    expect(await db.as(other, 'select * from email_outbox where event_id = $1', [ev.id])).toEqual([])
    expect((await db.fails('anon', 'select * from email_outbox')).code).toBe('42501')
    const mine = await db.as<{ id: string }>(org, 'select id from email_outbox where event_id = $1', [ev.id])
    expect(mine.length).toBeGreaterThan(3)
    expect((await db.fails(other, 'select resend_email($1)', [mine[0]!.id])).code).toBe('PT403')
    expect((await db.fails(org, `insert into email_outbox(event_id, kind, to_email, subject, body) values ($1, 'registered', 'x@y.co', 's', 'b')`, [ev.id])).code).toBe('42501')
    expect((await db.fails(org, 'select * from claim_emails(5)')).code).toBe('42501')
  })

  it('sending claims due messages, records success, and backs off after a failure', async () => {
    const batch = await db.admin<{ id: string; attempts: number }>('select id, attempts from claim_emails(2)')
    expect(batch).toHaveLength(2)
    expect(batch.every((b) => b.attempts === 1)).toBe(true)
    await db.admin(`select finish_email($1, true, 'msg_1', null)`, [batch[0]!.id])
    await db.admin(`select finish_email($1, false, null, 'domain not verified')`, [batch[1]!.id])
    const [ok] = await db.admin<{ status: string; sent_at: string | null }>('select status, sent_at from email_outbox where id = $1', [batch[0]!.id])
    expect(ok!.status).toBe('sent')
    expect(ok!.sent_at).not.toBeNull()
    const [bad] = await db.admin<{ status: string; last_error: string; later: boolean }>(`select status, last_error, next_try_at > now() + interval '4 minutes' later from email_outbox where id = $1`, [batch[1]!.id])
    expect(bad).toEqual({ status: 'failed', last_error: 'domain not verified', later: true })
    // Not due yet, so not claimed again; an admin can send it again now.
    const again = await db.admin<{ id: string }>('select id from claim_emails(50)')
    expect(again.map((a) => a.id)).not.toContain(batch[1]!.id)
    await db.as(org, 'select resend_email($1)', [batch[1]!.id])
    const [now] = await db.admin<{ status: string; attempts: number }>('select status, attempts from email_outbox where id = $1', [batch[1]!.id])
    expect(now).toEqual({ status: 'pending', attempts: 0 })
  })

  it('only organizers can see or change the sending settings', async () => {
    expect((await db.fails('anon', 'select * from email_settings')).code).toBe('42501')
    await db.as(org, `update email_settings set from_address = 'tournaments@example.org', reply_to = 'chris@example.com'`)
    expect((await db.fails(org, `update email_settings set function_url = 'https://evil.example'`)).code).toBe('42501')
    const [s] = await db.as<{ from_address: string }>(org, 'select from_address from email_settings')
    expect(s!.from_address).toBe('tournaments@example.org')
  })
})
