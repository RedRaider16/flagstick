-- ============================================================================
-- Flagstick — Phase 1 schema
-- Run once in the Supabase SQL editor (or `supabase db push`).
--
-- Security model
--   * Browsers use the publishable key, i.e. the `anon` role (signed out) or the
--     `authenticated` role (signed in). Row Level Security decides what they see.
--   * Only people listed in public.organizers can create events.
--   * Per-event roles live in public.event_staff (admin | scorekeeper).
--   * Scores are written ONLY through set_score()/clear_score(), which check the
--     caller's role, group assignment, round/event status and the row version.
--     Direct INSERT/UPDATE/DELETE on scores is revoked from browser roles.
--   * Status changes (publish, start, lock, finalize, reopen, WD/DQ) go through
--     functions that record who did what in event_log.
-- ============================================================================

-- ── Helpers that don't depend on tables ────────────────────────────────────

create or replace function public.current_email()
returns text language sql stable security definer set search_path = '' as $$
  select lower(email) from auth.users where id = auth.uid()
$$;

create or replace function public.gen_public_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I
  code text := '';
begin
  for i in 1..6 loop
    code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return code;
end $$;

-- ── Tables ─────────────────────────────────────────────────────────────────

create table public.organizers (
  email text primary key check (email = lower(email) and email like '%@%'),
  created_at timestamptz not null default now()
);
comment on table public.organizers is
  'Who may create events. Add rows in the SQL editor: insert into organizers(email) values (''you@example.com'');';

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  city text not null default '' check (char_length(city) <= 120),
  created_at timestamptz not null default now()
);

create table public.tees (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  rating numeric(4,1) check (rating is null or rating between 50 and 90),
  slope int check (slope is null or slope between 55 and 155),
  created_at timestamptz not null default now(),
  unique (course_id, name)
);

create table public.holes (
  tee_id uuid not null references public.tees(id) on delete cascade,
  number int not null check (number between 1 and 18),
  par int not null check (par between 3 and 6),
  yardage int check (yardage is null or yardage between 50 and 800),
  stroke_index int not null check (stroke_index between 1 and 18),
  primary key (tee_id, number),
  constraint holes_unique_si unique (tee_id, stroke_index) deferrable initially deferred
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique check (public_code ~ '^[A-Z0-9]{6}$'),
  name text not null check (char_length(name) between 1 and 120),
  course_id uuid not null references public.courses(id) on delete restrict,
  event_date date not null,
  timezone text not null default 'America/Chicago' check (char_length(timezone) between 1 and 64),
  description text not null default '' check (char_length(description) <= 2000),
  status text not null default 'draft' check (status in ('draft','published','in_progress','finalized')),
  tiebreak_policy text not null default 'share' check (tiebreak_policy in ('share','card_back')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  round_number int not null default 1 check (round_number >= 1),
  round_date date not null,
  tee_id uuid references public.tees(id) on delete restrict,
  format text not null check (format in ('stroke_individual','scramble_2')),
  start_type text not null default 'tee_times' check (start_type in ('tee_times','shotgun')),
  status text not null default 'open' check (status in ('open','locked','finalized')),
  created_at timestamptz not null default now(),
  unique (event_id, round_number),
  unique (id, event_id)
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  first_name text not null check (char_length(first_name) between 1 and 60),
  last_name text not null check (char_length(last_name) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (id, event_id)
);

-- Contact details are kept apart so public policies can never expose them.
create table public.player_contacts (
  player_id uuid primary key,
  event_id uuid not null,
  email text not null default '' check (email = '' or email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  phone text not null default '' check (phone = '' or phone ~ '^[0-9 ()+.-]{7,20}$'),
  foreign key (player_id, event_id) references public.players(id, event_id) on delete cascade
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (event_id, name),
  unique (id, event_id)
);

create table public.team_members (
  team_id uuid not null,
  player_id uuid not null,
  event_id uuid not null,
  primary key (team_id, player_id),
  unique (event_id, player_id), -- a player is on at most one team per event
  foreign key (team_id, event_id) references public.teams(id, event_id) on delete cascade,
  foreign key (player_id, event_id) references public.players(id, event_id) on delete cascade
);

-- An entry is what appears on the leaderboard: a player (individual) or a team (scramble).
create table public.entries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  kind text not null check (kind in ('player','team')),
  player_id uuid unique,
  team_id uuid unique,
  status text not null default 'active' check (status in ('active','wd','dq')),
  status_note text not null default '' check (char_length(status_note) <= 200),
  created_at timestamptz not null default now(),
  unique (id, event_id),
  check ((kind = 'player' and player_id is not null and team_id is null)
      or (kind = 'team' and team_id is not null and player_id is null)),
  foreign key (player_id, event_id) references public.players(id, event_id) on delete cascade,
  foreign key (team_id, event_id) references public.teams(id, event_id) on delete cascade
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null,
  event_id uuid not null,
  name text not null check (char_length(name) between 1 and 40),
  tee_time time,
  starting_hole int not null default 1 check (starting_hole between 1 and 18),
  created_at timestamptz not null default now(),
  unique (round_id, name),
  unique (id, round_id),
  unique (id, event_id),
  foreign key (round_id, event_id) references public.rounds(id, event_id) on delete cascade
);

create table public.group_entries (
  group_id uuid not null,
  round_id uuid not null,
  entry_id uuid not null,
  event_id uuid not null,
  primary key (group_id, entry_id),
  unique (round_id, entry_id), -- an entry is in at most one group per round
  foreign key (group_id, round_id) references public.groups(id, round_id) on delete cascade,
  foreign key (round_id, event_id) references public.rounds(id, event_id) on delete cascade,
  foreign key (entry_id, event_id) references public.entries(id, event_id) on delete cascade
);

-- One row per entry per hole. A missing hole is a missing row, never 0.
create table public.scores (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null,
  entry_id uuid not null,
  event_id uuid not null,
  hole int not null check (hole between 1 and 18),
  strokes int not null check (strokes between 1 and 20),
  version int not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique (round_id, entry_id, hole),
  foreign key (round_id, event_id) references public.rounds(id, event_id) on delete cascade,
  foreign key (entry_id, event_id) references public.entries(id, event_id) on delete cascade
);
create index scores_round_idx on public.scores(round_id);

-- No foreign keys: history must survive deletes.
create table public.score_audit (
  id bigint generated always as identity primary key,
  event_id uuid not null,
  round_id uuid not null,
  entry_id uuid not null,
  hole int not null,
  action text not null check (action in ('insert','update','delete')),
  old_strokes int,
  new_strokes int,
  reason text not null default '',
  changed_by uuid,
  changed_by_email text not null default '',
  changed_at timestamptz not null default now()
);
create index score_audit_event_idx on public.score_audit(event_id, changed_at desc);

create table public.event_staff (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  email text not null check (email = lower(email) and email like '%@%'),
  user_id uuid references auth.users(id) on delete set null,
  role text not null check (role in ('admin','scorekeeper')),
  created_at timestamptz not null default now(),
  unique (event_id, email),
  unique (id, event_id)
);
create index event_staff_user_idx on public.event_staff(user_id);

create table public.staff_groups (
  staff_id uuid not null,
  group_id uuid not null,
  event_id uuid not null,
  primary key (staff_id, group_id),
  foreign key (staff_id, event_id) references public.event_staff(id, event_id) on delete cascade,
  foreign key (group_id, event_id) references public.groups(id, event_id) on delete cascade
);

create table public.event_log (
  id bigint generated always as identity primary key,
  event_id uuid not null,
  action text not null,
  detail text not null default '',
  actor_id uuid,
  actor_email text not null default '',
  at timestamptz not null default now()
);
create index event_log_event_idx on public.event_log(event_id, at desc);

-- ── Permission helpers (SECURITY DEFINER so they can read through RLS) ─────

create or replace function public.is_organizer()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organizers o where o.email = public.current_email())
$$;

create or replace function public.is_event_admin(p_event uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.event_staff s
                 where s.event_id = p_event and s.user_id = auth.uid() and s.role = 'admin')
$$;

create or replace function public.is_event_staff(p_event uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.event_staff s
                 where s.event_id = p_event and s.user_id = auth.uid())
$$;

create or replace function public.event_visible(p_event uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.events e where e.id = p_event
                 and (e.status in ('published','in_progress','finalized') or public.is_event_staff(e.id)))
$$;

create or replace function public.can_score_entry(p_round uuid, p_entry uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_entries ge
    join public.staff_groups sg on sg.group_id = ge.group_id
    join public.event_staff s on s.id = sg.staff_id
    where ge.round_id = p_round and ge.entry_id = p_entry
      and s.user_id = auth.uid() and s.role = 'scorekeeper')
$$;

create or replace function public.log_event(p_event uuid, p_action text, p_detail text)
returns void language sql security definer set search_path = '' as $$
  insert into public.event_log(event_id, action, detail, actor_id, actor_email)
  values (p_event, p_action, coalesce(p_detail, ''), auth.uid(), coalesce(public.current_email(), ''))
$$;

-- ── Triggers ───────────────────────────────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();

-- Keep entries in step with the event format.
create or replace function public.event_format(p_event uuid)
returns text language sql stable security definer set search_path = '' as $$
  select format from public.rounds where event_id = p_event order by round_number limit 1
$$;

create or replace function public.players_make_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.event_format(new.event_id) = 'stroke_individual' then
    insert into public.entries(event_id, kind, player_id) values (new.event_id, 'player', new.id);
  end if;
  return new;
end $$;
create trigger players_make_entry after insert on public.players
  for each row execute function public.players_make_entry();

create or replace function public.teams_make_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.event_format(new.event_id) = 'scramble_2' then
    insert into public.entries(event_id, kind, team_id) values (new.event_id, 'team', new.id);
  end if;
  return new;
end $$;
create trigger teams_make_entry after insert on public.teams
  for each row execute function public.teams_make_entry();

create or replace function public.rounds_format_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.format is distinct from old.format then
    if exists (select 1 from public.scores where round_id = old.id) then
      raise exception 'The format can''t change after scores have been entered.' using errcode = 'PT409';
    end if;
    delete from public.entries where event_id = new.event_id;
    if new.format = 'stroke_individual' then
      insert into public.entries(event_id, kind, player_id)
        select new.event_id, 'player', id from public.players where event_id = new.event_id;
    else
      insert into public.entries(event_id, kind, team_id)
        select new.event_id, 'team', id from public.teams where event_id = new.event_id;
    end if;
  end if;
  return new;
end $$;
create trigger rounds_format_change after update of format on public.rounds
  for each row execute function public.rounds_format_change();

-- Two-person teams in Phase 1.
create or replace function public.team_size_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.team_members where team_id = new.team_id) >= 2 then
    raise exception 'A scramble team can have at most two players.' using errcode = 'PT409';
  end if;
  return new;
end $$;
create trigger team_size_guard before insert on public.team_members
  for each row execute function public.team_size_guard();

-- Don't silently destroy scores by removing a player or team: mark WD instead.
create or replace function public.guard_scored_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.scores s join public.entries e on e.id = s.entry_id
             where (tg_table_name = 'players' and e.player_id = old.id)
                or (tg_table_name = 'teams' and e.team_id = old.id)) then
    raise exception 'This % has scores. Mark the entry WD instead of deleting it.',
      case tg_table_name when 'players' then 'player' else 'team' end using errcode = 'PT409';
  end if;
  return old;
end $$;
create trigger players_guard before delete on public.players
  for each row execute function public.guard_scored_delete();
create trigger teams_guard before delete on public.teams
  for each row execute function public.guard_scored_delete();

-- Course layout can't change under a finalized round.
create or replace function public.holes_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_tee uuid;
begin
  if tg_op = 'DELETE' then v_tee := old.tee_id; else v_tee := new.tee_id; end if;
  if exists (select 1 from public.rounds where tee_id = v_tee and status = 'finalized') then
    raise exception 'This tee is used by a finalized round; its holes can''t change.' using errcode = 'PT409';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger holes_guard before insert or update or delete on public.holes
  for each row execute function public.holes_guard();

-- Every score change is written to score_audit, including edits made in the SQL editor.
create or replace function public.scores_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_reason text := coalesce(current_setting('flagstick.reason', true), '');
begin
  if tg_op = 'DELETE' then
    insert into public.score_audit(event_id, round_id, entry_id, hole, action, old_strokes, new_strokes, reason, changed_by, changed_by_email)
    values (old.event_id, old.round_id, old.entry_id, old.hole, 'delete', old.strokes, null, v_reason, auth.uid(), coalesce(public.current_email(), ''));
    return old;
  elsif tg_op = 'UPDATE' then
    insert into public.score_audit(event_id, round_id, entry_id, hole, action, old_strokes, new_strokes, reason, changed_by, changed_by_email)
    values (new.event_id, new.round_id, new.entry_id, new.hole, 'update', old.strokes, new.strokes, v_reason, auth.uid(), coalesce(public.current_email(), ''));
  else
    insert into public.score_audit(event_id, round_id, entry_id, hole, action, old_strokes, new_strokes, reason, changed_by, changed_by_email)
    values (new.event_id, new.round_id, new.entry_id, new.hole, 'insert', null, new.strokes, v_reason, auth.uid(), coalesce(public.current_email(), ''));
  end if;
  return new;
end $$;
create trigger scores_audit after insert or update or delete on public.scores
  for each row execute function public.scores_audit();

-- ── RPC: events and staff ──────────────────────────────────────────────────

create or replace function public.create_event(
  p_name text, p_course uuid, p_tee uuid, p_date date, p_timezone text, p_description text,
  p_format text, p_start_type text, p_tiebreak text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_event uuid; v_code text; v_email text := public.current_email();
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'PT401'; end if;
  if not public.is_organizer() then
    raise exception 'Only organizers can create events.' using errcode = 'PT403';
  end if;
  if not exists (select 1 from public.courses where id = p_course and owner_id = auth.uid()) then
    raise exception 'Course not found.' using errcode = 'PT403';
  end if;
  if p_tee is not null and not exists (select 1 from public.tees where id = p_tee and course_id = p_course) then
    raise exception 'That tee doesn''t belong to the course.' using errcode = 'PT409';
  end if;
  for i in 1..20 loop
    v_code := public.gen_public_code();
    exit when not exists (select 1 from public.events where public_code = v_code);
  end loop;
  insert into public.events(public_code, name, course_id, event_date, timezone, description, tiebreak_policy, created_by)
  values (v_code, p_name, p_course, p_date, coalesce(nullif(p_timezone, ''), 'America/Chicago'),
          coalesce(p_description, ''), coalesce(p_tiebreak, 'share'), auth.uid())
  returning id into v_event;
  insert into public.rounds(event_id, round_number, round_date, tee_id, format, start_type)
  values (v_event, 1, p_date, p_tee, p_format, coalesce(p_start_type, 'tee_times'));
  insert into public.event_staff(event_id, email, user_id, role) values (v_event, v_email, auth.uid(), 'admin');
  perform public.log_event(v_event, 'event_created', p_name);
  return v_event;
end $$;

-- Link pending staff invitations to the signed-in user (matched by email).
create or replace function public.claim_staff_invites()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if auth.uid() is null then return 0; end if;
  update public.event_staff set user_id = auth.uid()
   where email = public.current_email() and user_id is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Readiness checks before scoring can start.
create or replace function public.start_blockers(p_event uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare r public.rounds; problems text[] := '{}'; n int;
begin
  select * into r from public.rounds where event_id = p_event and round_number = 1;
  if r.tee_id is null then problems := problems || 'Choose a tee for the round.'::text; end if;
  select count(*) into n from public.holes where tee_id = r.tee_id;
  if r.tee_id is not null and n <> 18 then problems := problems || format('The tee has %s of 18 holes set up.', n)::text; end if;
  if not exists (select 1 from public.entries where event_id = p_event) then
    problems := problems || ('Add at least one ' || case r.format when 'scramble_2' then 'team.' else 'player.' end)::text;
  end if;
  if r.format = 'scramble_2' then
    for n in select 1 from public.teams t
      where t.event_id = p_event and (select count(*) from public.team_members m where m.team_id = t.id) <> 2 loop
      problems := problems || 'Every scramble team needs exactly two players.'::text;
      exit;
    end loop;
  end if;
  return problems;
end $$;

create or replace function public.set_event_status(p_event uuid, p_status text, p_reason text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare v_old text; v_blockers text[];
begin
  if not public.is_event_admin(p_event) then raise exception 'Admins only.' using errcode = 'PT403'; end if;
  select status into v_old from public.events where id = p_event for update;
  if v_old = p_status then return; end if;
  if not ((v_old = 'draft' and p_status = 'published')
       or (v_old = 'published' and p_status in ('draft','in_progress'))
       or (v_old = 'in_progress' and p_status = 'published')) then
    raise exception 'Can''t change status from % to %. Use finalize/reopen for final results.', v_old, p_status
      using errcode = 'PT409';
  end if;
  if p_status = 'in_progress' then
    v_blockers := public.start_blockers(p_event);
    if array_length(v_blockers, 1) > 0 then
      raise exception 'Not ready to start: %', array_to_string(v_blockers, ' ') using errcode = 'PT409';
    end if;
  end if;
  if v_old = 'in_progress' and p_status = 'published' and coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason for pausing scoring.' using errcode = 'PT409';
  end if;
  update public.events set status = p_status where id = p_event;
  perform public.log_event(p_event, 'status:' || v_old || '->' || p_status, p_reason);
end $$;

create or replace function public.set_round_lock(p_round uuid, p_locked boolean, p_reason text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare r public.rounds;
begin
  select * into r from public.rounds where id = p_round for update;
  if not found or not public.is_event_admin(r.event_id) then raise exception 'Admins only.' using errcode = 'PT403'; end if;
  if r.status = 'finalized' then raise exception 'The round is final. Reopen it first.' using errcode = 'PT409'; end if;
  update public.rounds set status = case when p_locked then 'locked' else 'open' end where id = p_round;
  perform public.log_event(r.event_id, case when p_locked then 'round_locked' else 'round_unlocked' end, p_reason);
end $$;

create or replace function public.finalize_round(p_round uuid, p_reason text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare r public.rounds; v_incomplete int; v_event_status text;
begin
  select * into r from public.rounds where id = p_round for update;
  if not found or not public.is_event_admin(r.event_id) then raise exception 'Admins only.' using errcode = 'PT403'; end if;
  if r.status = 'finalized' then return; end if;
  select status into v_event_status from public.events where id = r.event_id for update;
  if v_event_status <> 'in_progress' then
    raise exception 'Start the event before finalizing.' using errcode = 'PT409';
  end if;
  select count(*) into v_incomplete from public.entries e
   where e.event_id = r.event_id and e.status = 'active'
     and (select count(*) from public.scores s where s.round_id = r.id and s.entry_id = e.id) < 18;
  if v_incomplete > 0 then
    raise exception '% active entr% not complete. Finish their cards or mark them WD/DQ.',
      v_incomplete, case when v_incomplete = 1 then 'y is' else 'ies are' end using errcode = 'PT409';
  end if;
  update public.rounds set status = 'finalized' where id = p_round;
  update public.events set status = 'finalized' where id = r.event_id;
  perform public.log_event(r.event_id, 'finalized', p_reason);
end $$;

create or replace function public.reopen_round(p_round uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.rounds;
begin
  select * into r from public.rounds where id = p_round for update;
  if not found or not public.is_event_admin(r.event_id) then raise exception 'Admins only.' using errcode = 'PT403'; end if;
  if r.status <> 'finalized' then raise exception 'The round isn''t final.' using errcode = 'PT409'; end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to reopen final results.' using errcode = 'PT409';
  end if;
  -- Reopens as LOCKED: only admins can correct until it is explicitly unlocked.
  update public.rounds set status = 'locked' where id = p_round;
  update public.events set status = 'in_progress' where id = r.event_id;
  perform public.log_event(r.event_id, 'reopened', p_reason);
end $$;

create or replace function public.set_entry_status(p_entry uuid, p_status text, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare e public.entries;
begin
  select * into e from public.entries where id = p_entry for update;
  if not found or not public.is_event_admin(e.event_id) then raise exception 'Admins only.' using errcode = 'PT403'; end if;
  if p_status not in ('active','wd','dq') then raise exception 'Unknown status.' using errcode = 'PT409'; end if;
  if exists (select 1 from public.rounds where event_id = e.event_id and status = 'finalized') then
    raise exception 'Results are final. Reopen the round first.' using errcode = 'PT409';
  end if;
  update public.entries set status = p_status, status_note = coalesce(p_note, '') where id = p_entry;
  perform public.log_event(e.event_id, 'entry_status:' || e.status || '->' || p_status,
                           p_entry::text || coalesce(' ' || nullif(p_note, ''), ''));
end $$;

-- ── RPC: scores (optimistic concurrency) ───────────────────────────────────
-- p_expected_version: the version the caller last saw, or NULL if the caller
-- believes the hole is empty. A mismatch raises PT409 (HTTP 409) with the
-- current value in DETAIL so the client can show "someone else changed this".

create or replace function public.assert_can_write_score(p_round uuid, p_entry uuid, p_reason text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare r public.rounds; v_event_status text; v_entry_status text; v_admin boolean;
begin
  if auth.uid() is null then raise exception 'Sign in to enter scores.' using errcode = 'PT401'; end if;
  select * into r from public.rounds where id = p_round;
  if not found then raise exception 'Round not found.' using errcode = 'PT404'; end if;
  select status into v_entry_status from public.entries where id = p_entry and event_id = r.event_id;
  if not found then raise exception 'That entry is not in this event.' using errcode = 'PT404'; end if;
  v_admin := public.is_event_admin(r.event_id);
  if not v_admin and not public.can_score_entry(p_round, p_entry) then
    raise exception 'You are not assigned to score this group.' using errcode = 'PT403';
  end if;
  select status into v_event_status from public.events where id = r.event_id;
  if r.status = 'finalized' or v_event_status = 'finalized' then
    raise exception 'Results are final. An admin must reopen the round to make changes.' using errcode = 'PT409';
  end if;
  if v_admin then
    if v_event_status = 'draft' then raise exception 'Publish the event first.' using errcode = 'PT409'; end if;
    if r.status = 'locked' and coalesce(trim(p_reason), '') = '' then
      raise exception 'The round is locked. Give a reason for this correction.' using errcode = 'PT409';
    end if;
  else
    if v_event_status <> 'in_progress' then
      raise exception 'Scoring is not open for this event.' using errcode = 'PT409';
    end if;
    if r.status = 'locked' then raise exception 'The round is locked.' using errcode = 'PT409'; end if;
    if v_entry_status <> 'active' then
      raise exception 'This entry is marked %; only an admin can change its scores.', upper(v_entry_status) using errcode = 'PT409';
    end if;
  end if;
  return r.event_id;
end $$;

create or replace function public.set_score(
  p_round uuid, p_entry uuid, p_hole int, p_strokes int, p_expected_version int, p_reason text default ''
) returns public.scores language plpgsql security definer set search_path = '' as $$
declare v_event uuid; cur public.scores; res public.scores;
begin
  v_event := public.assert_can_write_score(p_round, p_entry, p_reason);
  if p_hole is null or p_hole < 1 or p_hole > 18 then raise exception 'Hole must be 1–18.' using errcode = 'PT400'; end if;
  if p_strokes is null or p_strokes < 1 or p_strokes > 20 then
    raise exception 'A hole score must be between 1 and 20.' using errcode = 'PT400';
  end if;
  perform set_config('flagstick.reason', coalesce(p_reason, ''), true);

  select * into cur from public.scores where round_id = p_round and entry_id = p_entry and hole = p_hole for update;
  if not found then
    if p_expected_version is not null then
      raise exception 'CONFLICT: this score was cleared by someone else.'
        using errcode = 'PT409', detail = json_build_object('current', null)::text;
    end if;
    begin
      insert into public.scores(round_id, entry_id, event_id, hole, strokes, updated_by)
      values (p_round, p_entry, v_event, p_hole, p_strokes, auth.uid()) returning * into res;
    exception when unique_violation then
      select * into cur from public.scores where round_id = p_round and entry_id = p_entry and hole = p_hole;
      raise exception 'CONFLICT: someone else saved this hole first.'
        using errcode = 'PT409', detail = json_build_object('current', row_to_json(cur))::text;
    end;
    return res;
  end if;

  if p_expected_version is distinct from cur.version then
    raise exception 'CONFLICT: someone else changed this hole.'
      using errcode = 'PT409', detail = json_build_object('current', row_to_json(cur))::text;
  end if;
  if cur.strokes = p_strokes then return cur; end if;
  update public.scores set strokes = p_strokes, version = cur.version + 1, updated_at = now(), updated_by = auth.uid()
   where id = cur.id returning * into res;
  return res;
end $$;

create or replace function public.clear_score(
  p_round uuid, p_entry uuid, p_hole int, p_expected_version int, p_reason text default ''
) returns void language plpgsql security definer set search_path = '' as $$
declare cur public.scores;
begin
  perform public.assert_can_write_score(p_round, p_entry, p_reason);
  perform set_config('flagstick.reason', coalesce(p_reason, ''), true);
  select * into cur from public.scores where round_id = p_round and entry_id = p_entry and hole = p_hole for update;
  if not found then return; end if;
  if p_expected_version is distinct from cur.version then
    raise exception 'CONFLICT: someone else changed this hole.'
      using errcode = 'PT409', detail = json_build_object('current', row_to_json(cur))::text;
  end if;
  delete from public.scores where id = cur.id;
end $$;

-- ── Row Level Security ─────────────────────────────────────────────────────

alter table public.organizers      enable row level security;
alter table public.courses         enable row level security;
alter table public.tees            enable row level security;
alter table public.holes           enable row level security;
alter table public.events          enable row level security;
alter table public.rounds          enable row level security;
alter table public.players         enable row level security;
alter table public.player_contacts enable row level security;
alter table public.teams           enable row level security;
alter table public.team_members    enable row level security;
alter table public.entries         enable row level security;
alter table public.groups          enable row level security;
alter table public.group_entries   enable row level security;
alter table public.scores          enable row level security;
alter table public.score_audit     enable row level security;
alter table public.event_staff     enable row level security;
alter table public.staff_groups    enable row level security;
alter table public.event_log       enable row level security;

-- Organizers: you can see whether you're on the list. Writes only via SQL editor.
create policy organizers_self on public.organizers for select to authenticated
  using (email = public.current_email());

-- Course data isn't private (spectators need par/yardage); only the owner edits it.
create policy courses_read on public.courses for select to anon, authenticated using (true);
create policy courses_insert on public.courses for insert to authenticated
  with check (owner_id = auth.uid() and public.is_organizer());
create policy courses_write on public.courses for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy courses_delete on public.courses for delete to authenticated using (owner_id = auth.uid());

create policy tees_read on public.tees for select to anon, authenticated using (true);
create policy tees_write on public.tees for all to authenticated
  using (exists (select 1 from public.courses c where c.id = course_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from public.courses c where c.id = course_id and c.owner_id = auth.uid()));

create policy holes_read on public.holes for select to anon, authenticated using (true);
create policy holes_write on public.holes for all to authenticated
  using (exists (select 1 from public.tees t join public.courses c on c.id = t.course_id
                 where t.id = tee_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from public.tees t join public.courses c on c.id = t.course_id
                      where t.id = tee_id and c.owner_id = auth.uid()));

-- Events: drafts are visible to staff only; published+ are public.
create policy events_read on public.events for select to anon, authenticated using (public.event_visible(id));
create policy events_update on public.events for update to authenticated
  using (public.is_event_admin(id)) with check (public.is_event_admin(id));
create policy events_delete on public.events for delete to authenticated
  using (public.is_event_admin(id) and status = 'draft');

create policy rounds_read on public.rounds for select to anon, authenticated using (public.event_visible(event_id));
create policy rounds_update on public.rounds for update to authenticated
  using (public.is_event_admin(event_id)) with check (public.is_event_admin(event_id));

-- Roster data that spectators may see (names only).
create policy players_read on public.players for select to anon, authenticated using (public.event_visible(event_id));
create policy players_write on public.players for all to authenticated
  using (public.is_event_admin(event_id)) with check (public.is_event_admin(event_id));

create policy contacts_admin on public.player_contacts for all to authenticated
  using (public.is_event_admin(event_id)) with check (public.is_event_admin(event_id));

create policy teams_read on public.teams for select to anon, authenticated using (public.event_visible(event_id));
create policy teams_write on public.teams for all to authenticated
  using (public.is_event_admin(event_id)) with check (public.is_event_admin(event_id));

create policy team_members_read on public.team_members for select to anon, authenticated using (public.event_visible(event_id));
create policy team_members_write on public.team_members for all to authenticated
  using (public.is_event_admin(event_id)) with check (public.is_event_admin(event_id));

create policy entries_read on public.entries for select to anon, authenticated using (public.event_visible(event_id));

create policy groups_read on public.groups for select to anon, authenticated using (public.event_visible(event_id));
create policy groups_write on public.groups for all to authenticated
  using (public.is_event_admin(event_id)) with check (public.is_event_admin(event_id));

create policy group_entries_read on public.group_entries for select to anon, authenticated using (public.event_visible(event_id));
create policy group_entries_write on public.group_entries for all to authenticated
  using (public.is_event_admin(event_id)) with check (public.is_event_admin(event_id));

create policy scores_read on public.scores for select to anon, authenticated using (public.event_visible(event_id));

create policy score_audit_admin on public.score_audit for select to authenticated using (public.is_event_admin(event_id));
create policy event_log_admin on public.event_log for select to authenticated using (public.is_event_admin(event_id));

create policy staff_read on public.event_staff for select to authenticated
  using (public.is_event_admin(event_id) or user_id = auth.uid());
create policy staff_insert on public.event_staff for insert to authenticated
  with check (public.is_event_admin(event_id));
create policy staff_delete on public.event_staff for delete to authenticated
  using (public.is_event_admin(event_id) and coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid) <> auth.uid());

create policy staff_groups_read on public.staff_groups for select to authenticated
  using (public.is_event_admin(event_id)
         or exists (select 1 from public.event_staff s where s.id = staff_id and s.user_id = auth.uid()));
create policy staff_groups_write on public.staff_groups for all to authenticated
  using (public.is_event_admin(event_id)) with check (public.is_event_admin(event_id));

-- ── Table privileges (defence in depth on top of RLS) ──────────────────────
-- Supabase grants ALL on public tables to anon/authenticated by default. Narrow it.

revoke insert, update, delete, truncate on all tables in schema public from anon;
revoke truncate on all tables in schema public from authenticated;
revoke insert, update, delete on public.organizers, public.events, public.rounds, public.entries,
  public.scores, public.score_audit, public.event_log from authenticated;
revoke update on public.event_staff from authenticated;
-- Admins may edit descriptive event/round fields directly; status only via functions.
grant update (name, event_date, timezone, description, tiebreak_policy) on public.events to authenticated;
grant delete on public.events to authenticated;
grant update (round_date, tee_id, format, start_type) on public.rounds to authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.current_email(), public.is_organizer(), public.is_event_admin(uuid), public.is_event_staff(uuid),
  public.event_visible(uuid), public.can_score_entry(uuid, uuid), public.event_format(uuid)
  to anon, authenticated;
grant execute on function
  public.create_event(text, uuid, uuid, date, text, text, text, text, text),
  public.claim_staff_invites(), public.start_blockers(uuid),
  public.set_event_status(uuid, text, text), public.set_round_lock(uuid, boolean, text),
  public.finalize_round(uuid, text), public.reopen_round(uuid, text),
  public.set_entry_status(uuid, text, text),
  public.set_score(uuid, uuid, int, int, int, text), public.clear_score(uuid, uuid, int, int, text)
  to authenticated;

-- ── Realtime ───────────────────────────────────────────────────────────────
-- Full replica identity lets clients filter DELETE events by round/event id.
alter table public.scores replica identity full;
alter table public.entries replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.scores, public.entries, public.events, public.rounds;
  end if;
end $$;
