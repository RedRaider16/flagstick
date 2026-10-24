// Runs the real migration inside PGlite (Postgres compiled to WASM) with a small
// emulation of what Supabase provides: the auth schema, auth.uid(), the anon and
// authenticated roles, and Supabase's default table/function grants. Every query
// in a test runs as a specific role with a specific JWT `sub`, so RLS and the
// SECURITY DEFINER checks behave the way they will in production.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SUPABASE_SHIM = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text not null);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(
    current_setting('request.jwt.claim.sub', true),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- Supabase's defaults: browser roles get ALL on new public objects; RLS + revokes narrow it.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`

export interface TestUser {
  id: string
  email: string
}

export type Actor = TestUser | 'anon'

export class TestDb {
  private constructor(readonly pg: PGlite) {}

  /** A database with every migration applied, or only those before `stopBefore` (to rehearse an upgrade). */
  static async create(stopBefore?: string): Promise<TestDb> {
    const pg = new PGlite()
    await pg.exec(SUPABASE_SHIM)
    const db = new TestDb(pg)
    await db.migrate(undefined, stopBefore)
    return db
  }

  /** Apply migration files in order from `from` (inclusive) up to `stopBefore` (exclusive). */
  async migrate(from?: string, stopBefore?: string): Promise<void> {
    const dir = join(process.cwd(), 'supabase', 'migrations')
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
      if (from && f < from) continue
      if (stopBefore && f >= stopBefore) break
      await this.pg.exec(readFileSync(join(dir, f), 'utf8'))
    }
  }

  async user(email: string): Promise<TestUser> {
    const id = crypto.randomUUID()
    await this.pg.query('insert into auth.users(id, email) values ($1, $2)', [id, email])
    return { id, email }
  }

  /** Run SQL as postgres (like the Supabase SQL editor). */
  async admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pg.query<T>(sql, params)).rows
  }

  /** Run one statement as a browser client. */
  async as<T = Record<string, unknown>>(actor: Actor, sql: string, params: unknown[] = []): Promise<T[]> {
    return this.pg.transaction(async (tx) => {
      if (actor === 'anon') {
        await tx.exec(`set local role anon; select set_config('request.jwt.claims', '', true);`)
      } else {
        const claims = JSON.stringify({ sub: actor.id, email: actor.email, role: 'authenticated' })
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claims])
        await tx.exec('set local role authenticated')
      }
      return (await tx.query<T>(sql, params)).rows
    })
  }

  /** Expect a client call to fail; returns the Postgres error code and message. */
  async fails(actor: Actor, sql: string, params: unknown[] = []): Promise<{ code: string; message: string; detail?: string }> {
    try {
      await this.as(actor, sql, params)
    } catch (e) {
      const err = e as { code?: string; message: string; detail?: string }
      return { code: err.code ?? '', message: err.message, detail: err.detail }
    }
    throw new Error(`Expected failure but succeeded: ${sql}`)
  }
}
