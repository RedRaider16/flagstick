-- ============================================================================
-- Flagstick — Phase 2b: the formats, flights and multi-day events the annual
-- tournaments use, plus templates you duplicate each year.
--
--   * Team size 1–4 per event (1 = individual). Entries are players or teams
--     accordingly.
--   * Each round has "segments": hole ranges with a scoring method:
--       individual   one score per player (team size 1 only)
--       scramble     one team score per hole
--       alt_shot     one team score per hole
--       best_ball    one score per player; the lowest `count` scores count
--     e.g. Jimmy Roger = best_ball count 2 on 1–18 with 3-person teams;
--     the 666 = scramble 1–6, alt_shot 7–12, best_ball count 1 on 13–18.
--   * Scores for best-ball holes are stored per player (scores.player_id);
--     scramble/alternate-shot/individual scores have player_id null.
--   * Flights: named divisions; each entry is in at most one. Rounds say
--     whether their own leaderboard is split by flight.
--   * Events are cumulative (overall total across rounds) or per-round
--     (each day is its own competition, e.g. United Way).
--   * Players can play a different tee from the round's default.
--   * Entry statuses DNF and NS (no show) join WD and DQ: all are unranked.
--   * Templates are draft events that can't be published; duplicate_event()
--     copies an event's setup (no players) into a new draft.
-- ============================================================================

-- ── Events ─────────────────────────────────────────────────────────────────

alter table public.events
  add column team_size int not null default 1 check (team_size between 1 and 4),
  add column cumulative boolean not null default true,
  add column is_template boolean not null default false;

update public.events e set team_size = 2
 where exists (select 1 from public.rounds r where r.event_id = e.id and r.format = 'scramble_2');

alter table public.events add constraint events_template_draft check (not is_template or status = 'draft');

create or replace function public.event_team_size(p_event uuid)
returns int language sql stable security definer set search_path = '' as $$
  select team_size from public.events where id = p_event
$$;

-- ── Rounds: segments replace the single format column ──────────────────────

alter table public.rounds
  add column segments jsonb,
  add column use_flights boolean not null default true;

update public.rounds set segments = case format
  when 'scramble_2' then '[{"from":1,"to":18,"method":"scramble","count":1}]'
  else '[{"from":1,"to":18,"method":"individual","count":1}]' end::jsonb;

drop trigger rounds_format_change on public.rounds;
drop function public.rounds_format_change();
alter table public.rounds drop column format;
alter table public.rounds alter column segments set not null;

-- Returns a problem description, or null if the segments are valid for the team size.
create or replace function public.segments_problem(p jsonb, p_team_size int)
returns text language plpgsql immutable set search_path = '' as $$
declare s jsonb; v_next int := 1; f int; t int; m text; c int;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) = 0 then
    return 'Choose a format for the round.';
  end if;
  for s in select value from jsonb_array_elements(p) with ordinality order by ordinality loop
    begin
      f := (s->>'from')::int; t := (s->>'to')::int; m := s->>'method'; c := coalesce((s->>'count')::int, 1);
    exception when others then
      return 'The round format is malformed.';
    end;
    if f is distinct from v_next or t is null or t < f or t > 18 then
      return 'Format segments must cover holes 1–18 in order.';
    end if;
    if p_team_size = 1 and m is distinct from 'individual' then
      return 'Individual events use stroke play on every hole.';
    end if;
    if p_team_size > 1 and m not in ('scramble', 'alt_shot', 'best_ball') then
      return 'Team events use scramble, alternate shot or best ball.';
    end if;
    if m = 'best_ball' and (c < 1 or c > p_team_size) then
      return format('Best ball must count between 1 and %s scores per hole.', p_team_size);
    end if;
    v_next := t + 1;
  end loop;
  if v_next <> 19 then return 'Format segments must cover holes 1–18.'; end if;
  return null;
end $$;

create or replace function public.default_segments(p_team_size int)
returns jsonb language sql immutable set search_path = '' as $$
  select case when p_team_size = 1 then '[{"from":1,"to":18,"method":"individual","count":1}]'::jsonb
              else '[{"from":1,"to":18,"method":"scramble","count":1}]'::jsonb end
$$;

-- Scoring method used on a hole of a round.
create or replace function public.hole_method(p_segments jsonb, p_hole int)
returns text language sql immutable set search_path = '' as $$
  select s->>'method' from jsonb_array_elements(p_segments) s
   where p_hole between (s->>'from')::int and (s->>'to')::int limit 1
$$;

create or replace function public.rounds_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_problem text;
begin
  v_problem := public.segments_problem(new.segments, public.event_team_size(new.event_id));
  if v_problem is not null then raise exception '%', v_problem using errcode = 'PT409'; end if;
  if tg_op = 'UPDATE' and new.segments is distinct from old.segments
     and exists (select 1 from public.scores where round_id = old.id) then
    raise exception 'The format can''t change after scores have been entered.' using errcode = 'PT409';
  end if;
  if new.tee_id is not null and not exists (
       select 1 from public.tees t join public.events e on e.course_id = t.course_id
        where t.id = new.tee_id and e.id = new.event_id) then
    raise exception 'That tee isn''t on this event''s course.' using errcode = 'PT409';
  end if;
  return new;
end $$;
create trigger rounds_guard before insert or update on public.rounds
  for each row execute function public.rounds_guard();

-- ── Entries follow the team size ───────────────────────────────────────────

drop trigger players_make_entry on public.players;
drop trigger teams_make_entry on public.teams;

create or replace function public.players_make_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.event_team_size(new.event_id) = 1 then
    insert into public.entries(event_id, kind, player_id) values (new.event_id, 'player', new.id);
  end if;
  return new;
end $$;
create trigger players_make_entry after insert on public.players
  for each row execute function public.players_make_entry();

create or replace function public.teams_make_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.event_team_size(new.event_id) > 1 then
    insert into public.entries(event_id, kind, team_id) values (new.event_id, 'team', new.id);
  end if;
  return new;
end $$;
create trigger teams_make_entry after insert on public.teams
  for each row execute function public.teams_make_entry();

drop function public.event_format(uuid);

create or replace function public.events_team_size_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.team_size is distinct from old.team_size then
    if exists (select 1 from public.scores where event_id = old.id) then
      raise exception 'The team size can''t change after scores have been entered.' using errcode = 'PT409';
    end if;
    if exists (select 1 from public.team_members m where m.event_id = old.id
               group by m.team_id having count(*) > new.team_size) and new.team_size > 1 then
      raise exception 'Some teams have more than % players. Change those teams first.', new.team_size using errcode = 'PT409';
    end if;
    -- Rounds whose format doesn't suit the new size go back to the default.
    update public.rounds set segments = public.default_segments(new.team_size)
     where event_id = old.id and public.segments_problem(segments, new.team_size) is not null;
    delete from public.entries where event_id = old.id;
    if new.team_size = 1 then
      insert into public.entries(event_id, kind, player_id)
        select old.id, 'player', id from public.players where event_id = old.id;
    else
      insert into public.entries(event_id, kind, team_id)
        select old.id, 'team', id from public.teams where event_id = old.id;
    end if;
  end if;
  return new;
end $$;
-- AFTER, so rounds_guard sees the new team size when the rounds are reset.
create trigger events_team_size_change after update of team_size on public.events
  for each row execute function public.events_team_size_change();

create or replace function public.team_size_guard()
returns trigger language plpgsql set search_path = '' as $$
declare v_size int := public.event_team_size(new.event_id);
begin
  if (select count(*) from public.team_members where team_id = new.team_id) >= v_size then
    raise exception 'A team in this event can have at most % players.', v_size using errcode = 'PT409';
  end if;
  return new;
end $$;

-- ── Entry statuses and flights ─────────────────────────────────────────────

alter table public.entries drop constraint entries_status_check;
alter table public.entries add constraint entries_status_check check (status in ('active','wd','dq','dnf','ns'));

create table public.flights (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (event_id, name),
  unique (id, event_id)
);

alter table public.entries add column flight_id uuid;
alter table public.entries add constraint entries_flight_fk foreign key (flight_id, event_id)
  references public.flights(id, event_id) on delete set null (flight_id);

-- ── Per-player tees ────────────────────────────────────────────────────────

alter table public.players add column tee_id uuid references public.tees(id) on delete set null;

create or replace function public.players_tee_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.tee_id is not null and not exists (
       select 1 from public.tees t join public.events e on e.course_id = t.course_id
        where t.id = new.tee_id and e.id = new.event_id) then
    raise exception 'That tee isn''t on this event''s course.' using errcode = 'PT409';
  end if;
  return new;
end $$;
create trigger players_tee_guard before insert or update of tee_id on public.players
  for each row execute function public.players_tee_guard();

-- ── Per-player scores for best-ball holes ──────────────────────────────────

alter table public.scores add column player_id uuid;
alter table public.scores add constraint scores_player_fk foreign key (player_id, event_id)
  references public.players(id, event_id) on delete cascade;
alter table public.scores drop constraint scores_round_id_entry_id_hole_key;
alter table public.scores add constraint scores_one_per_slot unique nulls not distinct (round_id, entry_id, hole, player_id);

alter table public.score_audit add column player_id uuid;

create or replace function public.scores_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_reason text := coalesce(current_setting('flagstick.reason', true), '');
begin
  if tg_op = 'DELETE' then
    insert into public.score_audit(event_id, round_id, entry_id, player_id, hole, action, old_strokes, new_strokes, reason, changed_by, changed_by_email)
    values (old.event_id, old.round_id, old.entry_id, old.player_id, old.hole, 'delete', old.strokes, null, v_reason, auth.uid(), coalesce(public.current_email(), ''));
    return old;
  elsif tg_op = 'UPDATE' then
    insert into public.score_audit(event_id, round_id, entry_id, player_id, hole, action, old_strokes, new_strokes, reason, changed_by, changed_by_email)
    values (new.event_id, new.round_id, new.entry_id, new.player_id, new.hole, 'update', old.strokes, new.strokes, v_reason, auth.uid(), coalesce(public.current_email(), ''));
  else
    insert into public.score_audit(event_id, round_id, entry_id, player_id, hole, action, old_strokes, new_strokes, reason, changed_by, changed_by_email)
    values (new.event_id, new.round_id, new.entry_id, new.player_id, new.hole, 'insert', null, new.strokes, v_reason, auth.uid(), coalesce(public.current_email(), ''));
  end if;
  return new;
end $$;

-- Holes an entry has finished in a round (best-ball holes need `count` player scores).
create or replace function public.round_holes_done(p_round uuid, p_entry uuid)
returns int language sql stable security definer set search_path = '' as $$
  with seg as (
    select (s->>'from')::int f, (s->>'to')::int t, s->>'method' m, coalesce((s->>'count')::int, 1) c
      from public.rounds r, jsonb_array_elements(r.segments) s where r.id = p_round),
  h as (select g.h, seg.m, seg.c from seg, generate_series(seg.f, seg.t) g(h))
  select count(*)::int from h where case when h.m = 'best_ball'
    then (select count(*) from public.scores x where x.round_id = p_round and x.entry_id = p_entry
            and x.hole = h.h and x.player_id is not null) >= h.c
    else exists (select 1 from public.scores x where x.round_id = p_round and x.entry_id = p_entry
            and x.hole = h.h and x.player_id is null) end
$$;

drop function public.set_score(uuid, uuid, int, int, int, text);
drop function public.clear_score(uuid, uuid, int, int, text);

-- Which kind of score a hole takes, and that the player belongs to the entry.
create or replace function public.assert_score_slot(p_round uuid, p_entry uuid, p_hole int, p_player uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_method text; e public.entries;
begin
  if p_hole is null or p_hole < 1 or p_hole > 18 then raise exception 'Hole must be 1–18.' using errcode = 'PT400'; end if;
  select public.hole_method(segments, p_hole) into v_method from public.rounds where id = p_round;
  select * into e from public.entries where id = p_entry;
  if v_method = 'best_ball' then
    if p_player is null then
      raise exception 'Hole % is best ball: enter each player''s score.', p_hole using errcode = 'PT400';
    end if;
    if not exists (select 1 from public.team_members where team_id = e.team_id and player_id = p_player) then
      raise exception 'That player isn''t on this team.' using errcode = 'PT409';
    end if;
  elsif p_player is not null then
    raise exception 'Hole % takes one score for the %.', p_hole,
      case e.kind when 'team' then 'team' else 'player' end using errcode = 'PT400';
  end if;
end $$;

create or replace function public.set_score(
  p_round uuid, p_entry uuid, p_hole int, p_strokes int, p_expected_version int,
  p_reason text default '', p_player uuid default null
) returns public.scores language plpgsql security definer set search_path = '' as $$
declare v_event uuid; cur public.scores; res public.scores;
begin
  v_event := public.assert_can_write_score(p_round, p_entry, p_reason);
  perform public.assert_score_slot(p_round, p_entry, p_hole, p_player);
  if p_strokes is null or p_strokes < 1 or p_strokes > 20 then
    raise exception 'A hole score must be between 1 and 20.' using errcode = 'PT400';
  end if;
  perform set_config('flagstick.reason', coalesce(p_reason, ''), true);

  select * into cur from public.scores
   where round_id = p_round and entry_id = p_entry and hole = p_hole and player_id is not distinct from p_player for update;
  if not found then
    if p_expected_version is not null then
      raise exception 'CONFLICT: this score was cleared by someone else.'
        using errcode = 'PT409', detail = json_build_object('current', null)::text;
    end if;
    begin
      insert into public.scores(round_id, entry_id, event_id, player_id, hole, strokes, updated_by)
      values (p_round, p_entry, v_event, p_player, p_hole, p_strokes, auth.uid()) returning * into res;
    exception when unique_violation then
      select * into cur from public.scores
       where round_id = p_round and entry_id = p_entry and hole = p_hole and player_id is not distinct from p_player;
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
  p_round uuid, p_entry uuid, p_hole int, p_expected_version int, p_reason text default '', p_player uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
declare cur public.scores;
begin
  perform public.assert_can_write_score(p_round, p_entry, p_reason);
  perform set_config('flagstick.reason', coalesce(p_reason, ''), true);
  select * into cur from public.scores
   where round_id = p_round and entry_id = p_entry and hole = p_hole and player_id is not distinct from p_player for update;
  if not found then return; end if;
  if p_expected_version is distinct from cur.version then
    raise exception 'CONFLICT: someone else changed this hole.'
      using errcode = 'PT409', detail = json_build_object('current', row_to_json(cur))::text;
  end if;
  delete from public.scores where id = cur.id;
end $$;

-- ── Event and round RPCs ───────────────────────────────────────────────────

drop function public.create_event(text, uuid, uuid, date, text, text, text, text, text);

create or replace function public.create_event(
  p_name text, p_course uuid, p_tee uuid, p_date date, p_timezone text, p_description text,
  p_team_size int, p_segments jsonb, p_start_type text, p_tiebreak text
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
  for i in 1..20 loop
    v_code := public.gen_public_code();
    exit when not exists (select 1 from public.events where public_code = v_code);
  end loop;
  insert into public.events(public_code, name, course_id, event_date, timezone, description, tiebreak_policy, team_size, created_by)
  values (v_code, p_name, p_course, p_date, coalesce(nullif(p_timezone, ''), 'America/Chicago'),
          coalesce(p_description, ''), coalesce(p_tiebreak, 'share'), coalesce(p_team_size, 1), auth.uid())
  returning id into v_event;
  insert into public.rounds(event_id, round_number, round_date, tee_id, segments, start_type)
  values (v_event, 1, p_date, p_tee, coalesce(p_segments, public.default_segments(coalesce(p_team_size, 1))),
          coalesce(p_start_type, 'tee_times'));
  insert into public.event_staff(event_id, email, user_id, role) values (v_event, v_email, auth.uid(), 'admin');
  perform public.log_event(v_event, 'event_created', p_name);
  return v_event;
end $$;

create or replace function public.add_round(p_event uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare last public.rounds; v_id uuid;
begin
  if not public.is_event_admin(p_event) then raise exception 'Admins only.' using errcode = 'PT403'; end if;
  select * into last from public.rounds where event_id = p_event order by round_number desc limit 1 for update;
  if last.round_number >= 6 then raise exception 'An event can have at most 6 rounds.' using errcode = 'PT409'; end if;
  if (select status from public.events where id = p_event) = 'finalized' then
    raise exception 'Results are final. Reopen a round first.' using errcode = 'PT409';
  end if;
  insert into public.rounds(event_id, round_number, round_date, tee_id, segments, start_type, use_flights)
  values (p_event, last.round_number + 1, last.round_date + 1, last.tee_id, last.segments, last.start_type, last.use_flights)
  returning id into v_id;
  perform public.log_event(p_event, 'round_added', 'Round ' || (last.round_number + 1));
  return v_id;
end $$;

create or replace function public.delete_round(p_round uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.rounds;
begin
  select * into r from public.rounds where id = p_round for update;
  if not found or not public.is_event_admin(r.event_id) then raise exception 'Admins only.' using errcode = 'PT403'; end if;
  if r.round_number = 1 and not exists (select 1 from public.rounds where event_id = r.event_id and round_number > 1) then
    raise exception 'An event needs at least one round.' using errcode = 'PT409';
  end if;
  if exists (select 1 from public.scores where round_id = p_round) then
    raise exception 'This round has scores and can''t be removed.' using errcode = 'PT409';
  end if;
  delete from public.rounds where id = p_round;
  -- Renumber the rest without colliding with the unique (event_id, round_number).
  update public.rounds set round_number = round_number + 100 where event_id = r.event_id and round_number > r.round_number;
  update public.rounds set round_number = round_number - 101 where event_id = r.event_id and round_number > 100;
  perform public.log_event(r.event_id, 'round_removed', 'Round ' || r.round_number);
end $$;

-- Bulk-assign entries to a flight (null = no flight).
create or replace function public.set_entry_flights(p_event uuid, p_assignments jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare a jsonb;
begin
  if not public.is_event_admin(p_event) then raise exception 'Admins only.' using errcode = 'PT403'; end if;
  if (select status from public.events where id = p_event) = 'finalized' then
    raise exception 'Results are final. Reopen a round first.' using errcode = 'PT409';
  end if;
  for a in select value from jsonb_array_elements(p_assignments) loop
    if nullif(a->>'flight_id', '') is not null and not exists (
         select 1 from public.flights where id = (a->>'flight_id')::uuid and event_id = p_event) then
      raise exception 'Unknown flight.' using errcode = 'PT409';
    end if;
    update public.entries set flight_id = nullif(a->>'flight_id', '')::uuid
     where id = (a->>'entry_id')::uuid and event_id = p_event;
  end loop;
  perform public.log_event(p_event, 'flights_assigned', jsonb_array_length(p_assignments) || ' entries');
end $$;

create or replace function public.start_blockers(p_event uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare r public.rounds; e public.events; problems text[] := '{}'; n int; v_min int := 2;
begin
  select * into e from public.events where id = p_event;
  for r in select * from public.rounds where event_id = p_event order by round_number loop
    if r.tee_id is null then
      problems := problems || format('Choose a tee for round %s.', r.round_number)::text;
    else
      select count(*) into n from public.holes where tee_id = r.tee_id;
      if n <> 18 then problems := problems || format('Round %s''s tee has %s of 18 holes set up.', r.round_number, n)::text; end if;
    end if;
    select greatest(v_min, coalesce(max((s->>'count')::int), 1)) into v_min
      from jsonb_array_elements(r.segments) s where s->>'method' = 'best_ball';
  end loop;
  for n in select 1 from public.players p where p.event_id = p_event and p.tee_id is not null
            and (select count(*) from public.holes h where h.tee_id = p.tee_id) <> 18 limit 1 loop
    problems := problems || 'A player''s tee doesn''t have all 18 holes set up.'::text;
  end loop;
  if not exists (select 1 from public.entries where event_id = p_event) then
    problems := problems || (case when e.team_size = 1 then 'Add at least one player.' else 'Add at least one team.' end)::text;
  end if;
  if e.team_size > 1 then
    for n in select 1 from public.teams t where t.event_id = p_event
              and (select count(*) from public.team_members m where m.team_id = t.id) < v_min limit 1 loop
      problems := problems || format('Every team needs at least %s player%s.', v_min, case when v_min = 1 then '' else 's' end)::text;
    end loop;
  end if;
  return problems;
end $$;

create or replace function public.set_event_status(p_event uuid, p_status text, p_reason text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare v_old text; v_blockers text[]; v_template boolean;
begin
  if not public.is_event_admin(p_event) then raise exception 'Admins only.' using errcode = 'PT403'; end if;
  select status, is_template into v_old, v_template from public.events where id = p_event for update;
  if v_old = p_status then return; end if;
  if v_template then
    raise exception 'This is a template. Create this year''s event from it, then publish that.' using errcode = 'PT409';
  end if;
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
   where e.event_id = r.event_id and e.status = 'active' and public.round_holes_done(r.id, e.id) < 18;
  if v_incomplete > 0 then
    raise exception '% active entr% not complete. Finish their cards or mark them WD, DNF or NS.',
      v_incomplete, case when v_incomplete = 1 then 'y is' else 'ies are' end using errcode = 'PT409';
  end if;
  update public.rounds set status = 'finalized' where id = p_round;
  if not exists (select 1 from public.rounds where event_id = r.event_id and status <> 'finalized') then
    update public.events set status = 'finalized' where id = r.event_id;
  end if;
  perform public.log_event(r.event_id, 'finalized', 'Round ' || r.round_number || coalesce('. ' || nullif(trim(p_reason), ''), ''));
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
  update public.rounds set status = 'locked' where id = p_round;
  update public.events set status = 'in_progress' where id = r.event_id;
  perform public.log_event(r.event_id, 'reopened', 'Round ' || r.round_number || '. ' || p_reason);
end $$;

create or replace function public.set_entry_status(p_entry uuid, p_status text, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare e public.entries;
begin
  select * into e from public.entries where id = p_entry for update;
  if not found or not public.is_event_admin(e.event_id) then raise exception 'Admins only.' using errcode = 'PT403'; end if;
  if p_status not in ('active','wd','dq','dnf','ns') then raise exception 'Unknown status.' using errcode = 'PT409'; end if;
  if (select status from public.events where id = e.event_id) = 'finalized' then
    raise exception 'Results are final. Reopen a round first.' using errcode = 'PT409';
  end if;
  update public.entries set status = p_status, status_note = coalesce(p_note, '') where id = p_entry;
  perform public.log_event(e.event_id, 'entry_status:' || e.status || '->' || p_status,
                           p_entry::text || coalesce(' ' || nullif(p_note, ''), ''));
end $$;

-- ── Templates: copy an event's setup into a new draft ──────────────────────

create or replace function public.duplicate_event(
  p_source uuid, p_name text, p_date date, p_as_template boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.events; v_event uuid; v_code text; v_shift int; f public.flights; r public.rounds;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'PT401'; end if;
  if not public.is_organizer() or not public.is_event_admin(p_source) then
    raise exception 'Only this event''s admins can copy it.' using errcode = 'PT403';
  end if;
  if coalesce(trim(p_name), '') = '' or p_date is null then
    raise exception 'Give the new event a name and a date.' using errcode = 'PT400';
  end if;
  select * into s from public.events where id = p_source;
  v_shift := p_date - s.event_date;
  for i in 1..20 loop
    v_code := public.gen_public_code();
    exit when not exists (select 1 from public.events where public_code = v_code);
  end loop;
  insert into public.events(public_code, name, course_id, event_date, timezone, description, tiebreak_policy,
                            team_size, cumulative, is_template, created_by,
                            registration_open, registration_closes_at, max_players, entry_fee_cents, payment_instructions)
  values (v_code, left(trim(p_name), 120), s.course_id, p_date, s.timezone, s.description, s.tiebreak_policy,
          s.team_size, s.cumulative, coalesce(p_as_template, false), auth.uid(),
          false, s.registration_closes_at + make_interval(days => v_shift), s.max_players, s.entry_fee_cents, s.payment_instructions)
  returning id into v_event;
  for r in select * from public.rounds where event_id = p_source order by round_number loop
    insert into public.rounds(event_id, round_number, round_date, tee_id, segments, start_type, use_flights)
    values (v_event, r.round_number, r.round_date + v_shift, r.tee_id, r.segments, r.start_type, r.use_flights);
  end loop;
  for f in select * from public.flights where event_id = p_source order by sort_order, name loop
    insert into public.flights(event_id, name, sort_order) values (v_event, f.name, f.sort_order);
  end loop;
  insert into public.event_staff(event_id, email, user_id, role)
    select v_event, st.email, st.user_id, 'admin' from public.event_staff st
     where st.event_id = p_source and st.role = 'admin';
  insert into public.event_staff(event_id, email, user_id, role)
    select v_event, public.current_email(), auth.uid(), 'admin'
     where not exists (select 1 from public.event_staff where event_id = v_event and email = public.current_email());
  perform public.log_event(v_event, 'event_created', 'Copied from ' || s.name);
  return v_event;
end $$;

-- ── Registration follows the team size ─────────────────────────────────────

alter table public.registration_players drop constraint registration_players_position_check;
alter table public.registration_players add constraint registration_players_position_check check (position between 1 and 4);

create or replace function public.confirm_registration_internal(p_reg uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.registrations;
  rp public.registration_players;
  v_player uuid;
  v_team uuid;
  v_name text;
  v_ids uuid[] := '{}';
  v_last text[] := '{}';
  n int := 1;
begin
  select * into r from public.registrations where id = p_reg for update;
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

  if public.event_team_size(r.event_id) > 1 then
    v_name := left(coalesce(nullif(trim(r.team_name), ''), array_to_string(v_last, ' / ')), 60);
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

create or replace function public.register_for_event(
  p_code text, p_people jsonb, p_team_name text default '', p_note text default ''
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.events;
  v_size int;
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

  v_size := e.team_size;
  if jsonb_typeof(p_people) <> 'array' or jsonb_array_length(p_people) <> v_size then
    raise exception '%', case when v_size = 1 then 'Register one player at a time.'
                              else format('This is a %s-person team event. Enter all %s players.', v_size, v_size) end
      using errcode = 'PT400';
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
  v_status := case when e.max_players is not null and v_count + v_size > e.max_players then 'waitlisted' else 'confirmed' end;

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

-- ── RLS and privileges ─────────────────────────────────────────────────────

alter table public.flights enable row level security;
create policy flights_read on public.flights for select to anon, authenticated using (public.event_visible(event_id));
create policy flights_write on public.flights for all to authenticated
  using (public.is_event_admin(event_id)) with check (public.is_event_admin(event_id));
revoke insert, update, delete, truncate on public.flights from anon;
revoke truncate on public.flights from authenticated;

grant update (team_size, cumulative, is_template) on public.events to authenticated;
grant update (round_date, tee_id, segments, use_flights, start_type) on public.rounds to authenticated;

revoke execute on function
  public.event_team_size(uuid), public.segments_problem(jsonb, int), public.default_segments(int),
  public.hole_method(jsonb, int), public.round_holes_done(uuid, uuid), public.assert_score_slot(uuid, uuid, int, uuid),
  public.create_event(text, uuid, uuid, date, text, text, int, jsonb, text, text),
  public.add_round(uuid), public.delete_round(uuid), public.set_entry_flights(uuid, jsonb),
  public.duplicate_event(uuid, text, date, boolean),
  public.set_score(uuid, uuid, int, int, int, text, uuid), public.clear_score(uuid, uuid, int, int, text, uuid),
  public.rounds_guard(), public.events_team_size_change(), public.players_tee_guard()
  from public, anon, authenticated;
grant execute on function public.event_team_size(uuid), public.segments_problem(jsonb, int) to anon, authenticated;
grant execute on function
  public.create_event(text, uuid, uuid, date, text, text, int, jsonb, text, text),
  public.add_round(uuid), public.delete_round(uuid), public.set_entry_flights(uuid, jsonb),
  public.duplicate_event(uuid, text, date, boolean),
  public.set_score(uuid, uuid, int, int, int, text, uuid), public.clear_score(uuid, uuid, int, int, text, uuid)
  to authenticated;

alter table public.flights replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.flights;
  end if;
end $$;
