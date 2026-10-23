-- ============================================================================
-- Flagstick — Phase 2a: player registration, waitlist, payment tracking,
-- and handicap values recorded with their source and date.
--
-- Security model
--   * Anyone (signed in or not) can register ONLY through register_for_event(),
--     which checks the event is published, registration is open, the closing
--     time hasn't passed, the team size matches the format, and the email isn't
--     already registered. When the field is full, the registration is waitlisted.
--   * Registrations, registrant contact details and handicaps are visible to the
--     event's admins only. Spectators see player names (as before) and how many
--     spots are left.
--   * Admins update payment fields directly (column-level grants + RLS) and use
--     functions to cancel or promote, which keep players/teams/entries in step and
--     write to event_log.
--   * Handicap Index values are stored with source and date. Phase 2a does not
--     calculate Course or Playing Handicaps and does not use them in results.
-- ============================================================================

alter table public.events
  add column registration_open boolean not null default false,
  add column registration_closes_at timestamptz,
  add column max_players int check (max_players is null or max_players between 1 and 500),
  add column entry_fee_cents int check (entry_fee_cents is null or entry_fee_cents between 0 and 10000000),
  add column payment_instructions text not null default '' check (char_length(payment_instructions) <= 1000);

create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  ref text not null check (ref ~ '^[A-Z0-9]{6}$'),
  status text not null default 'confirmed' check (status in ('confirmed','waitlisted','cancelled')),
  team_name text not null default '' check (char_length(team_name) <= 60),
  team_id uuid references public.teams(id) on delete set null,
  registrant_note text not null default '' check (char_length(registrant_note) <= 500),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','paid','waived','refunded')),
  payment_method text not null default '' check (payment_method in ('','cash','check','card','online','other')),
  amount_paid_cents int check (amount_paid_cents is null or amount_paid_cents between 0 and 10000000),
  admin_note text not null default '' check (char_length(admin_note) <= 500),
  source text not null default 'online' check (source in ('online','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  unique (event_id, ref),
  unique (id, event_id)
);
create index registrations_event_idx on public.registrations(event_id, created_at);
create trigger registrations_touch before update on public.registrations
  for each row execute function public.touch_updated_at();

create table public.registration_players (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null,
  event_id uuid not null,
  position int not null check (position between 1 and 2),
  first_name text not null check (char_length(first_name) between 1 and 60),
  last_name text not null check (char_length(last_name) between 1 and 60),
  email text not null default '' check (email = '' or email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  phone text not null default '' check (phone = '' or phone ~ '^[0-9 ()+.-]{7,20}$'),
  handicap_index numeric(3,1) check (handicap_index is null or handicap_index between -10 and 54),
  player_id uuid unique references public.players(id) on delete set null,
  unique (registration_id, position),
  foreign key (registration_id, event_id) references public.registrations(id, event_id) on delete cascade
);
create index registration_players_email_idx on public.registration_players(event_id, lower(email));

-- Handicap Index as given, with where it came from and when. Not a Course or
-- Playing Handicap; nothing in Phase 2a calculates those.
create table public.player_handicaps (
  player_id uuid primary key,
  event_id uuid not null,
  handicap_index numeric(3,1) not null check (handicap_index between -10 and 54),
  source text not null check (char_length(source) between 1 and 80),
  as_of date not null default current_date,
  recorded_at timestamptz not null default now(),
  foreign key (player_id, event_id) references public.players(id, event_id) on delete cascade
);

-- ── Internal helpers (not callable from the browser) ───────────────────────

create or replace function public.gen_registration_ref(p_event uuid)
returns text language plpgsql volatile set search_path = '' as $$
declare v text;
begin
  for i in 1..30 loop
    v := public.gen_public_code();
    exit when not exists (select 1 from public.registrations where event_id = p_event and ref = v);
  end loop;
  return v;
end $$;

-- Create players (and a team for scrambles) for a registration and confirm it.
create or replace function public.confirm_registration_internal(p_reg uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.registrations;
  rp public.registration_players;
  v_format text;
  v_player uuid;
  v_team uuid;
  v_name text;
  v_ids uuid[] := '{}';
  v_last text[] := '{}';
  n int := 1;
begin
  select * into r from public.registrations where id = p_reg for update;
  v_format := public.event_format(r.event_id);
  for rp in select * from public.registration_players where registration_id = p_reg order by position loop
    insert into public.players(event_id, first_name, last_name)
    values (r.event_id, rp.first_name, rp.last_name) returning id into v_player;
    insert into public.player_contacts(player_id, event_id, email, phone)
    values (v_player, r.event_id, rp.email, rp.phone);
    if rp.handicap_index is not null then
      insert into public.player_handicaps(player_id, event_id, handicap_index, source, as_of)
      values (v_player, r.event_id, rp.handicap_index,
              case r.source when 'online' then 'Self-reported at registration' else 'Entered by admin' end,
              (r.created_at at time zone 'America/Chicago')::date);
    end if;
    update public.registration_players set player_id = v_player where id = rp.id;
    v_ids := v_ids || v_player;
    v_last := v_last || rp.last_name;
  end loop;

  if v_format = 'scramble_2' then
    v_name := coalesce(nullif(trim(r.team_name), ''), array_to_string(v_last, ' / '));
    while exists (select 1 from public.teams where event_id = r.event_id and lower(name) = lower(v_name)) loop
      n := n + 1;
      v_name := left(coalesce(nullif(trim(r.team_name), ''), array_to_string(v_last, ' / ')), 54) || ' (' || n || ')';
    end loop;
    insert into public.teams(event_id, name) values (r.event_id, v_name) returning id into v_team;
    insert into public.team_members(team_id, player_id, event_id)
      select v_team, unnest(v_ids), r.event_id;
    update public.registrations set team_id = v_team where id = p_reg;
  end if;

  update public.registrations set status = 'confirmed', cancelled_at = null where id = p_reg;
end $$;

-- ── Public RPC: register ────────────────────────────────────────────────────
-- p_people: [{first_name, last_name, email, phone, handicap_index}, ...]
-- Returns {status: 'confirmed'|'waitlisted', ref, team_name}

create or replace function public.register_for_event(
  p_code text, p_people jsonb, p_team_name text default '', p_note text default ''
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.events;
  v_format text;
  v_size int;
  v_needed int;
  v_count int;
  v_status text;
  v_team_name text;
  v_reg uuid;
  v_ref text;
  p jsonb;
  i int := 0;
  v_email text;
  v_emails text[] := '{}';
  v_hcp numeric;
begin
  select * into e from public.events where public_code = upper(trim(coalesce(p_code, ''))) for update;
  if not found or e.status not in ('published', 'in_progress') then
    raise exception 'This event is not open for registration.' using errcode = 'PT404';
  end if;
  if not e.registration_open then
    raise exception 'Registration for this event is closed.' using errcode = 'PT409';
  end if;
  if e.registration_closes_at is not null and now() >= e.registration_closes_at then
    raise exception 'Registration for this event closed on %.',
      to_char(e.registration_closes_at at time zone e.timezone, 'Mon DD at HH12:MI AM') using errcode = 'PT409';
  end if;
  if (select count(*) from public.registrations where event_id = e.id) >= 1000 then
    raise exception 'This event has reached its registration limit.' using errcode = 'PT409';
  end if;

  v_format := public.event_format(e.id);
  v_size := case v_format when 'scramble_2' then 2 else 1 end;
  if jsonb_typeof(p_people) <> 'array' or jsonb_array_length(p_people) <> v_size then
    raise exception '%', case v_size when 2 then 'This is a two-person team event. Enter both players.'
                                    else 'Register one player at a time.' end using errcode = 'PT400';
  end if;

  for p in select * from jsonb_array_elements(p_people) loop
    i := i + 1;
    if coalesce(trim(p->>'first_name'), '') = '' or coalesce(trim(p->>'last_name'), '') = '' then
      raise exception 'Player %: first and last name are required.', i using errcode = 'PT400';
    end if;
    v_email := lower(trim(coalesce(p->>'email', '')));
    if i = 1 and v_email = '' then
      raise exception 'An email address is required so the organizer can reach you.' using errcode = 'PT400';
    end if;
    if v_email <> '' then
      if v_email = any(v_emails) then
        raise exception 'Each player needs a different email address.' using errcode = 'PT400';
      end if;
      v_emails := v_emails || v_email;
      if exists (select 1 from public.registration_players rp join public.registrations r on r.id = rp.registration_id
                 where rp.event_id = e.id and lower(rp.email) = v_email and r.status <> 'cancelled') then
        raise exception '% is already registered for this event. Contact the organizer to make changes.', v_email
          using errcode = 'PT409';
      end if;
    end if;
    if nullif(trim(coalesce(p->>'handicap_index', '')), '') is not null then
      begin
        v_hcp := (p->>'handicap_index')::numeric;
      exception when others then
        raise exception 'Player %: handicap index must be a number like 12.4.', i using errcode = 'PT400';
      end;
      if v_hcp < -10 or v_hcp > 54 then
        raise exception 'Player %: handicap index must be between +10.0 and 54.0.', i using errcode = 'PT400';
      end if;
    end if;
  end loop;

  select count(*) into v_count from public.players where event_id = e.id;
  v_needed := v_size;
  v_status := case when e.max_players is not null and v_count + v_needed > e.max_players then 'waitlisted' else 'confirmed' end;

  v_ref := public.gen_registration_ref(e.id);
  insert into public.registrations(event_id, ref, status, team_name, registrant_note, source)
  values (e.id, v_ref, 'waitlisted', left(trim(coalesce(p_team_name, '')), 60), left(trim(coalesce(p_note, '')), 500), 'online')
  returning id into v_reg;

  i := 0;
  for p in select * from jsonb_array_elements(p_people) loop
    i := i + 1;
    insert into public.registration_players(registration_id, event_id, position, first_name, last_name, email, phone, handicap_index)
    values (v_reg, e.id, i, left(trim(p->>'first_name'), 60), left(trim(p->>'last_name'), 60),
            lower(trim(coalesce(p->>'email', ''))), trim(coalesce(p->>'phone', '')),
            nullif(trim(coalesce(p->>'handicap_index', '')), '')::numeric(3,1));
  end loop;

  if v_status = 'confirmed' then
    perform public.confirm_registration_internal(v_reg);
  end if;

  insert into public.event_log(event_id, action, detail, actor_id, actor_email)
  values (e.id, 'registration_' || v_status, v_ref, auth.uid(), coalesce(public.current_email(), ''));

  select t.name into v_team_name from public.teams t join public.registrations r on r.team_id = t.id where r.id = v_reg;
  return jsonb_build_object('status', v_status, 'ref', v_ref, 'team_name', v_team_name);
end $$;

-- ── Admin RPCs ─────────────────────────────────────────────────────────────

create or replace function public.promote_registration(p_reg uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.registrations;
begin
  select * into r from public.registrations where id = p_reg for update;
  if not found or not public.is_event_admin(r.event_id) then raise exception 'Admins only.' using errcode = 'PT403'; end if;
  if r.status <> 'waitlisted' then raise exception 'Only waitlisted registrations can be confirmed.' using errcode = 'PT409'; end if;
  if exists (select 1 from public.rounds where event_id = r.event_id and status = 'finalized') then
    raise exception 'Results are final. Reopen the round first.' using errcode = 'PT409';
  end if;
  perform public.confirm_registration_internal(p_reg);
  perform public.log_event(r.event_id, 'registration_promoted', r.ref);
end $$;

create or replace function public.cancel_registration(p_reg uuid, p_reason text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare r public.registrations;
begin
  select * into r from public.registrations where id = p_reg for update;
  if not found or not public.is_event_admin(r.event_id) then raise exception 'Admins only.' using errcode = 'PT403'; end if;
  if r.status = 'cancelled' then return; end if;
  if exists (select 1 from public.scores s join public.entries e on e.id = s.entry_id
             where (e.player_id in (select player_id from public.registration_players where registration_id = p_reg))
                or (r.team_id is not null and e.team_id = r.team_id)) then
    raise exception 'This registration has scores. Mark the entry WD instead of cancelling.' using errcode = 'PT409';
  end if;
  if r.team_id is not null then delete from public.teams where id = r.team_id; end if;
  delete from public.players where id in (select player_id from public.registration_players where registration_id = p_reg and player_id is not null);
  update public.registrations set status = 'cancelled', cancelled_at = now(), team_id = null where id = p_reg;
  perform public.log_event(r.event_id, 'registration_cancelled', r.ref || coalesce(' ' || nullif(trim(p_reason), ''), ''));
end $$;

-- Admin records a handicap index (e.g. corrected from GHIN by hand).
create or replace function public.set_player_handicap(p_player uuid, p_index numeric, p_source text, p_as_of date)
returns void language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  select event_id into v_event from public.players where id = p_player;
  if v_event is null or not public.is_event_admin(v_event) then raise exception 'Admins only.' using errcode = 'PT403'; end if;
  if p_index is null then
    delete from public.player_handicaps where player_id = p_player;
    return;
  end if;
  if p_index < -10 or p_index > 54 then raise exception 'Handicap index must be between +10.0 and 54.0.' using errcode = 'PT400'; end if;
  if coalesce(trim(p_source), '') = '' then raise exception 'Say where this handicap came from.' using errcode = 'PT400'; end if;
  insert into public.player_handicaps(player_id, event_id, handicap_index, source, as_of)
  values (p_player, v_event, round(p_index, 1), left(trim(p_source), 80), coalesce(p_as_of, current_date))
  on conflict (player_id) do update set handicap_index = excluded.handicap_index, source = excluded.source,
    as_of = excluded.as_of, recorded_at = now();
end $$;

-- ── Row Level Security ─────────────────────────────────────────────────────

alter table public.registrations        enable row level security;
alter table public.registration_players enable row level security;
alter table public.player_handicaps     enable row level security;

create policy registrations_admin_read on public.registrations for select to authenticated
  using (public.is_event_admin(event_id));
create policy registrations_admin_update on public.registrations for update to authenticated
  using (public.is_event_admin(event_id)) with check (public.is_event_admin(event_id));
create policy registration_players_admin_read on public.registration_players for select to authenticated
  using (public.is_event_admin(event_id));
create policy player_handicaps_admin_read on public.player_handicaps for select to authenticated
  using (public.is_event_admin(event_id));

revoke all on public.registrations, public.registration_players, public.player_handicaps from anon;
revoke insert, update, delete, truncate on public.registrations, public.registration_players, public.player_handicaps from authenticated;
grant select on public.registrations, public.registration_players, public.player_handicaps to authenticated;
grant update (payment_status, payment_method, amount_paid_cents, admin_note) on public.registrations to authenticated;
grant update (registration_open, registration_closes_at, max_players, entry_fee_cents, payment_instructions)
  on public.events to authenticated;

revoke execute on function
  public.gen_registration_ref(uuid), public.confirm_registration_internal(uuid),
  public.register_for_event(text, jsonb, text, text), public.promote_registration(uuid),
  public.cancel_registration(uuid, text), public.set_player_handicap(uuid, numeric, text, date)
  from public, anon, authenticated;
grant execute on function public.register_for_event(text, jsonb, text, text) to anon, authenticated;
grant execute on function
  public.promote_registration(uuid), public.cancel_registration(uuid, text),
  public.set_player_handicap(uuid, numeric, text, date)
  to authenticated;

-- Live updates for the admin registration list (RLS limits them to admins).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.registrations;
  end if;
end $$;
