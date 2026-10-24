-- ============================================================================
-- Flagstick — Phase 2c: what Golf Genius sets up when an event is created.
--
--   * Tee sheet per round: start time, starting hole, group size, minutes
--     between tee times.
--   * Registration: open date, waitlist limit, a public participant list, and
--     the organizer's own questions (text, yes/no, choice), asked once per
--     sign-up or for each player. Answers are admin-only.
--   * Net scoring: events score gross, net or both. Allowances are stored per
--     event. A player's Handicap Index is made public only for events that
--     score net (spectators' screens work out net scores from it).
--   * Side games per round: skins (gross or net, optional carryover), closest
--     to the pin and long drive (staff record the winner per hole).
--   * Payouts: place money per competition (gross/net, overall or a round,
--     overall or a flight), and purses for side games.
--   * create_event_setup(): the step-by-step New Event screen creates the whole
--     event in one call. duplicate_event() copies all of the above too.
-- ============================================================================

-- ── Rounds: tee sheet ──────────────────────────────────────────────────────

alter table public.rounds
  add column start_time time,
  add column starting_hole int not null default 1 check (starting_hole between 1 and 18),
  add column group_size int not null default 4 check (group_size between 1 and 6),
  add column tee_interval_minutes int not null default 10 check (tee_interval_minutes between 5 and 30);

-- ── Events: registration, scoring basis, purse visibility ──────────────────

alter table public.events
  add column registration_opens_at timestamptz,
  add column waitlist_limit int check (waitlist_limit is null or waitlist_limit between 0 and 500),
  add column show_participants boolean not null default false,
  add column scoring_basis text not null default 'gross' check (scoring_basis in ('gross','net','both')),
  add column net_allowances jsonb not null default
    '{"individual":95,"bestBall":85,"scramble":{"2":[35,15],"3":[20,15,10],"4":[25,20,15,10]},"altShot":50}'::jsonb,
  add column max_handicap_index numeric(3,1) check (max_handicap_index is null or max_handicap_index between 0 and 54),
  add column hide_purse boolean not null default false;

-- ── Registration questions and answers ─────────────────────────────────────

create table public.registration_questions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 120),
  kind text not null default 'text' check (kind in ('text','yes_no','choice')),
  choices text[] not null default '{}' check (cardinality(choices) <= 20),
  required boolean not null default false,
  per_player boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (id, event_id),
  check (kind <> 'choice' or cardinality(choices) >= 2)
);

create table public.registration_answers (
  registration_id uuid not null references public.registrations(id) on delete cascade,
  question_id uuid not null,
  event_id uuid not null references public.events(id) on delete cascade,
  foreign key (question_id, event_id) references public.registration_questions(id, event_id) on delete cascade,
  -- 0 = asked once for the sign-up; 1–4 = that player.
  position int not null check (position between 0 and 4),
  value text not null check (char_length(value) <= 200),
  primary key (registration_id, question_id, position)
);

-- ── Side games ─────────────────────────────────────────────────────────────

create table public.side_games (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  round_id uuid not null,
  kind text not null check (kind in ('skins','closest_to_pin','long_drive')),
  name text not null check (char_length(trim(name)) between 1 and 60),
  holes int[] not null default '{}',
  basis text not null default 'gross' check (basis in ('gross','net')),
  carryover boolean not null default false,
  purse_cents int not null default 0 check (purse_cents between 0 and 10000000),
  per_hole_cents int not null default 0 check (per_hole_cents between 0 and 1000000),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  check (holes <@ array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]),
  foreign key (round_id, event_id) references public.rounds(id, event_id) on delete cascade,
  unique (id, event_id)
);

-- Who's in a side game. No rows = every entry in the event.
create table public.side_game_entries (
  game_id uuid not null,
  entry_id uuid not null,
  event_id uuid not null references public.events(id) on delete cascade,
  primary key (game_id, entry_id),
  foreign key (game_id, event_id) references public.side_games(id, event_id) on delete cascade,
  foreign key (entry_id, event_id) references public.entries(id, event_id) on delete cascade
);

-- Closest to the pin / long drive winners, one per hole.
create table public.side_game_results (
  game_id uuid not null references public.side_games(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  hole int not null check (hole between 1 and 18),
  player_id uuid references public.players(id) on delete set null,
  entry_id uuid references public.entries(id) on delete set null,
  note text not null default '' check (char_length(note) <= 60),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (game_id, hole)
);

-- ── Payouts ────────────────────────────────────────────────────────────────

create table public.payout_tables (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  basis text not null default 'gross' check (basis in ('gross','net')),
  -- null = the event's overall result (or its only round)
  round_id uuid,
  -- null = the whole field (no flights)
  flight_id uuid,
  amounts_cents int[] not null default '{}' check (cardinality(amounts_cents) <= 30),
  created_at timestamptz not null default now(),
  unique nulls not distinct (event_id, basis, round_id, flight_id),
  foreign key (round_id, event_id) references public.rounds(id, event_id) on delete cascade,
  foreign key (flight_id, event_id) references public.flights(id, event_id) on delete cascade
);

-- ── Helpers ────────────────────────────────────────────────────────────────

-- Handicap Indexes of an event's players, for events that score net. Admins always.
create or replace function public.event_handicaps(p_event uuid)
returns table (player_id uuid, handicap_index numeric, source text, as_of date)
language sql stable security definer set search_path = '' as $$
  select h.player_id, h.handicap_index, h.source, h.as_of
    from public.player_handicaps h
   where h.event_id = p_event
     and (public.is_event_admin(p_event)
          or (public.event_visible(p_event)
              and (select scoring_basis from public.events where id = p_event) <> 'gross'))
$$;

create or replace function public.set_side_game_result(p_game uuid, p_hole int, p_player uuid, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare g public.side_games; v_entry uuid;
begin
  select * into g from public.side_games where id = p_game;
  if not found or not public.is_event_staff(g.event_id) then raise exception 'Staff only.' using errcode = 'PT403'; end if;
  if g.kind = 'skins' then raise exception 'Skins are worked out from the scores.' using errcode = 'PT409'; end if;
  if not (p_hole = any(g.holes)) then raise exception 'That hole isn''t part of this contest.' using errcode = 'PT409'; end if;
  if (select status from public.events where id = g.event_id) = 'finalized' then
    raise exception 'Results are final. Reopen a round first.' using errcode = 'PT409';
  end if;
  if p_player is null then
    delete from public.side_game_results where game_id = p_game and hole = p_hole;
  else
    select e.id into v_entry from public.entries e
     where e.event_id = g.event_id
       and (e.player_id = p_player or e.team_id in (select team_id from public.team_members where player_id = p_player))
     limit 1;
    if v_entry is null then raise exception 'That player isn''t in this event.' using errcode = 'PT409'; end if;
    insert into public.side_game_results(game_id, event_id, hole, player_id, entry_id, note, updated_at, updated_by)
    values (p_game, g.event_id, p_hole, p_player, v_entry, left(trim(coalesce(p_note, '')), 60), now(), auth.uid())
    on conflict (game_id, hole) do update set player_id = excluded.player_id, entry_id = excluded.entry_id,
      note = excluded.note, updated_at = now(), updated_by = auth.uid();
  end if;
  perform public.log_event(g.event_id, 'side_game_result', g.name || ' hole ' || p_hole);
end $$;

-- Validate and store sign-up answers. p_answers: [{question_id, position, value}]
create or replace function public.save_registration_answers(p_reg uuid, p_event uuid, p_size int, p_answers jsonb, p_check_required boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare q public.registration_questions; a jsonb; v text; pos int;
begin
  for q in select * from public.registration_questions where event_id = p_event order by sort_order loop
    for pos in select generate_series(case when q.per_player then 1 else 0 end, case when q.per_player then p_size else 0 end) loop
      v := null;
      for a in select value from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) loop
        if a->>'question_id' = q.id::text and coalesce((a->>'position')::int, 0) = pos then
          v := trim(coalesce(a->>'value', ''));
        end if;
      end loop;
      if coalesce(v, '') = '' then
        if q.required and p_check_required then
          raise exception '"%" is required%.', q.label, case when q.per_player then format(' for player %s', pos) else '' end
            using errcode = 'PT400';
        end if;
        delete from public.registration_answers where registration_id = p_reg and question_id = q.id and position = pos;
        continue;
      end if;
      if q.kind = 'yes_no' and v not in ('Yes','No') then
        raise exception 'Answer "%" with Yes or No.', q.label using errcode = 'PT400';
      end if;
      if q.kind = 'choice' and not (v = any(q.choices)) then
        raise exception 'Choose one of the options for "%".', q.label using errcode = 'PT400';
      end if;
      insert into public.registration_answers(registration_id, question_id, event_id, position, value)
      values (p_reg, q.id, p_event, pos, left(v, 200))
      on conflict (registration_id, question_id, position) do update set value = excluded.value;
    end loop;
  end loop;
end $$;

-- Admins edit a sign-up's answers (required ones may be left blank).
create or replace function public.set_registration_answers(p_reg uuid, p_answers jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.registrations; v_size int;
begin
  select * into r from public.registrations where id = p_reg;
  if not found or not public.is_event_admin(r.event_id) then raise exception 'Admins only.' using errcode = 'PT403'; end if;
  select count(*) into v_size from public.registration_players where registration_id = p_reg;
  perform public.save_registration_answers(p_reg, r.event_id, greatest(v_size, 1), p_answers, false);
end $$;

-- ── Registration: open date, waitlist limit, answers ───────────────────────

drop function public.register_for_event(text, jsonb, text, text);

create or replace function public.register_for_event(
  p_code text, p_people jsonb, p_team_name text default '', p_note text default '', p_answers jsonb default '[]'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.events;
  v_size int;
  v_count int;
  v_waiting int;
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
  if e.registration_opens_at is not null and now() < e.registration_opens_at then
    raise exception 'Registration opens on %.',
      to_char(e.registration_opens_at at time zone e.timezone, 'Mon DD at HH12:MI AM') using errcode = 'PT409';
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
  if v_status = 'waitlisted' and e.waitlist_limit is not null then
    select count(*) into v_waiting from public.registration_players rp join public.registrations r on r.id = rp.registration_id
     where r.event_id = e.id and r.status = 'waitlisted';
    if v_waiting + v_size > e.waitlist_limit then
      raise exception 'The field and the waitlist are full.' using errcode = 'PT409';
    end if;
  end if;

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

  perform public.save_registration_answers(v_reg, e.id, v_size, p_answers, true);

  if v_status = 'confirmed' then
    perform public.confirm_registration_internal(v_reg);
  end if;

  insert into public.event_log(event_id, action, detail, actor_id, actor_email)
  values (e.id, 'registration_' || v_status, v_ref, auth.uid(), coalesce(public.current_email(), ''));

  select t.name into v_team_name from public.teams t join public.registrations r on r.team_id = t.id where r.id = v_reg;
  return jsonb_build_object('status', v_status, 'ref', v_ref, 'team_name', v_team_name);
end $$;

-- ── Create a whole event from the setup steps ──────────────────────────────
--
-- p: { name, course_id, timezone, description, team_size, cumulative, tiebreak, is_template,
--      scoring_basis, net_allowances, max_handicap_index, hide_purse,
--      rounds: [{date, tee_id, segments, start_type, start_time, starting_hole, group_size,
--                tee_interval_minutes, use_flights}],
--      flights: [name, ...],
--      registration: {open, opens_at, closes_at, max_players, waitlist_limit, entry_fee_cents,
--                     payment_instructions, show_participants},
--      questions: [{label, kind, choices, required, per_player}],
--      side_games: [{round_number, kind, name, holes, basis, carryover, purse_cents, per_hole_cents}],
--      payouts: [{basis, round_number|null, flight_name|null, amounts_cents}] }

create or replace function public.create_event_setup(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_event uuid; v_code text; v_email text := public.current_email();
  r jsonb; q jsonb; g jsonb; pt jsonb; n int := 0; v_round uuid; v_flight uuid;
  v_reg jsonb := coalesce(p->'registration', '{}'::jsonb);
  v_first date;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'PT401'; end if;
  if not public.is_organizer() then raise exception 'Only organizers can create events.' using errcode = 'PT403'; end if;
  if not exists (select 1 from public.courses where id = (p->>'course_id')::uuid and owner_id = auth.uid()) then
    raise exception 'Course not found.' using errcode = 'PT403';
  end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Give the event a name.' using errcode = 'PT400'; end if;
  if jsonb_typeof(p->'rounds') <> 'array' or jsonb_array_length(p->'rounds') = 0 then
    raise exception 'An event needs at least one round.' using errcode = 'PT400';
  end if;
  if jsonb_array_length(p->'rounds') > 6 then raise exception 'An event can have at most 6 rounds.' using errcode = 'PT409'; end if;
  v_first := (p->'rounds'->0->>'date')::date;

  for i in 1..20 loop
    v_code := public.gen_public_code();
    exit when not exists (select 1 from public.events where public_code = v_code);
  end loop;
  insert into public.events(public_code, name, course_id, event_date, timezone, description, tiebreak_policy,
                            team_size, cumulative, is_template, created_by,
                            scoring_basis, net_allowances, max_handicap_index, hide_purse,
                            registration_open, registration_opens_at, registration_closes_at, max_players, waitlist_limit,
                            entry_fee_cents, payment_instructions, show_participants)
  values (v_code, left(trim(p->>'name'), 120), (p->>'course_id')::uuid, v_first,
          coalesce(nullif(p->>'timezone', ''), 'America/Chicago'), left(coalesce(p->>'description', ''), 2000),
          coalesce(nullif(p->>'tiebreak', ''), 'share'), coalesce((p->>'team_size')::int, 1),
          coalesce((p->>'cumulative')::boolean, true), coalesce((p->>'is_template')::boolean, false), auth.uid(),
          coalesce(nullif(p->>'scoring_basis', ''), 'gross'),
          coalesce(p->'net_allowances', '{"individual":95,"bestBall":85,"scramble":{"2":[35,15],"3":[20,15,10],"4":[25,20,15,10]},"altShot":50}'::jsonb),
          nullif(p->>'max_handicap_index', '')::numeric, coalesce((p->>'hide_purse')::boolean, false),
          coalesce((v_reg->>'open')::boolean, false) and not coalesce((p->>'is_template')::boolean, false),
          nullif(v_reg->>'opens_at', '')::timestamptz, nullif(v_reg->>'closes_at', '')::timestamptz,
          nullif(v_reg->>'max_players', '')::int, nullif(v_reg->>'waitlist_limit', '')::int,
          nullif(v_reg->>'entry_fee_cents', '')::int, left(coalesce(v_reg->>'payment_instructions', ''), 1000),
          coalesce((v_reg->>'show_participants')::boolean, false))
  returning id into v_event;

  for r in select value from jsonb_array_elements(p->'rounds') loop
    n := n + 1;
    insert into public.rounds(event_id, round_number, round_date, tee_id, segments, start_type, use_flights,
                              start_time, starting_hole, group_size, tee_interval_minutes)
    values (v_event, n, (r->>'date')::date, nullif(r->>'tee_id', '')::uuid,
            coalesce(r->'segments', public.default_segments(coalesce((p->>'team_size')::int, 1))),
            coalesce(nullif(r->>'start_type', ''), 'tee_times'), coalesce((r->>'use_flights')::boolean, true),
            nullif(r->>'start_time', '')::time, coalesce((r->>'starting_hole')::int, 1),
            coalesce((r->>'group_size')::int, 4), coalesce((r->>'tee_interval_minutes')::int, 10));
  end loop;

  n := 0;
  for r in select value from jsonb_array_elements(coalesce(p->'flights', '[]'::jsonb)) loop
    n := n + 1;
    insert into public.flights(event_id, name, sort_order) values (v_event, left(trim(r #>> '{}'), 40), n);
  end loop;

  n := 0;
  for q in select value from jsonb_array_elements(coalesce(p->'questions', '[]'::jsonb)) loop
    n := n + 1;
    insert into public.registration_questions(event_id, label, kind, choices, required, per_player, sort_order)
    values (v_event, left(trim(q->>'label'), 120), coalesce(nullif(q->>'kind', ''), 'text'),
            coalesce(array(select jsonb_array_elements_text(q->'choices')), '{}'),
            coalesce((q->>'required')::boolean, false), coalesce((q->>'per_player')::boolean, false), n);
  end loop;

  n := 0;
  for g in select value from jsonb_array_elements(coalesce(p->'side_games', '[]'::jsonb)) loop
    n := n + 1;
    select id into v_round from public.rounds where event_id = v_event and round_number = coalesce((g->>'round_number')::int, 1);
    if v_round is null then raise exception 'A side game refers to a round that doesn''t exist.' using errcode = 'PT400'; end if;
    insert into public.side_games(event_id, round_id, kind, name, holes, basis, carryover, purse_cents, per_hole_cents, sort_order)
    values (v_event, v_round, g->>'kind', left(trim(g->>'name'), 60),
            coalesce(array(select jsonb_array_elements_text(g->'holes')::int), '{}'),
            coalesce(nullif(g->>'basis', ''), 'gross'), coalesce((g->>'carryover')::boolean, false),
            coalesce((g->>'purse_cents')::int, 0), coalesce((g->>'per_hole_cents')::int, 0), n);
  end loop;

  for pt in select value from jsonb_array_elements(coalesce(p->'payouts', '[]'::jsonb)) loop
    v_round := null; v_flight := null;
    if nullif(pt->>'round_number', '') is not null then
      select id into v_round from public.rounds where event_id = v_event and round_number = (pt->>'round_number')::int;
    end if;
    if nullif(pt->>'flight_name', '') is not null then
      select id into v_flight from public.flights where event_id = v_event and name = pt->>'flight_name';
    end if;
    insert into public.payout_tables(event_id, basis, round_id, flight_id, amounts_cents)
    values (v_event, coalesce(nullif(pt->>'basis', ''), 'gross'), v_round, v_flight,
            coalesce(array(select jsonb_array_elements_text(pt->'amounts_cents')::int), '{}'))
    on conflict (event_id, basis, round_id, flight_id) do update set amounts_cents = excluded.amounts_cents;
  end loop;

  insert into public.event_staff(event_id, email, user_id, role) values (v_event, v_email, auth.uid(), 'admin');
  perform public.log_event(v_event, 'event_created', p->>'name');
  return v_event;
end $$;

-- ── Copying an event also copies all of the above ──────────────────────────

create or replace function public.duplicate_event(
  p_source uuid, p_name text, p_date date, p_as_template boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.events; v_event uuid; v_code text; v_shift int; f public.flights; r public.rounds;
        q public.registration_questions; g public.side_games; pt public.payout_tables;
        v_round uuid; v_flight uuid;
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
                            registration_open, registration_opens_at, registration_closes_at, max_players, waitlist_limit,
                            entry_fee_cents, payment_instructions, show_participants,
                            scoring_basis, net_allowances, max_handicap_index, hide_purse)
  values (v_code, left(trim(p_name), 120), s.course_id, p_date, s.timezone, s.description, s.tiebreak_policy,
          s.team_size, s.cumulative, coalesce(p_as_template, false), auth.uid(),
          false, s.registration_opens_at + make_interval(days => v_shift), s.registration_closes_at + make_interval(days => v_shift),
          s.max_players, s.waitlist_limit, s.entry_fee_cents, s.payment_instructions, s.show_participants,
          s.scoring_basis, s.net_allowances, s.max_handicap_index, s.hide_purse)
  returning id into v_event;
  for r in select * from public.rounds where event_id = p_source order by round_number loop
    insert into public.rounds(event_id, round_number, round_date, tee_id, segments, start_type, use_flights,
                              start_time, starting_hole, group_size, tee_interval_minutes)
    values (v_event, r.round_number, r.round_date + v_shift, r.tee_id, r.segments, r.start_type, r.use_flights,
            r.start_time, r.starting_hole, r.group_size, r.tee_interval_minutes);
  end loop;
  for f in select * from public.flights where event_id = p_source order by sort_order, name loop
    insert into public.flights(event_id, name, sort_order) values (v_event, f.name, f.sort_order);
  end loop;
  for q in select * from public.registration_questions where event_id = p_source order by sort_order loop
    insert into public.registration_questions(event_id, label, kind, choices, required, per_player, sort_order)
    values (v_event, q.label, q.kind, q.choices, q.required, q.per_player, q.sort_order);
  end loop;
  for g in select sg.* from public.side_games sg where sg.event_id = p_source order by sg.sort_order loop
    select nr.id into v_round from public.rounds nr join public.rounds orr on orr.round_number = nr.round_number
     where nr.event_id = v_event and orr.id = g.round_id;
    insert into public.side_games(event_id, round_id, kind, name, holes, basis, carryover, purse_cents, per_hole_cents, sort_order)
    values (v_event, v_round, g.kind, g.name, g.holes, g.basis, g.carryover, g.purse_cents, g.per_hole_cents, g.sort_order);
  end loop;
  for pt in select * from public.payout_tables where event_id = p_source loop
    v_round := null; v_flight := null;
    if pt.round_id is not null then
      select nr.id into v_round from public.rounds nr join public.rounds orr on orr.round_number = nr.round_number
       where nr.event_id = v_event and orr.id = pt.round_id;
    end if;
    if pt.flight_id is not null then
      select nf.id into v_flight from public.flights nf join public.flights ofl on ofl.name = nf.name
       where nf.event_id = v_event and ofl.id = pt.flight_id;
    end if;
    insert into public.payout_tables(event_id, basis, round_id, flight_id, amounts_cents)
    values (v_event, pt.basis, v_round, v_flight, pt.amounts_cents);
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

-- ── RLS and privileges ─────────────────────────────────────────────────────

alter table public.registration_questions enable row level security;
alter table public.registration_answers  enable row level security;
alter table public.side_games             enable row level security;
alter table public.side_game_entries      enable row level security;
alter table public.side_game_results      enable row level security;
alter table public.payout_tables          enable row level security;

-- Questions are public so the sign-up form can show them; answers are admin-only.
create policy registration_questions_read on public.registration_questions for select to anon, authenticated
  using (public.event_visible(event_id));
create policy registration_questions_write on public.registration_questions for all to authenticated
  using (public.is_event_admin(event_id)) with check (public.is_event_admin(event_id));
create policy registration_answers_admin_read on public.registration_answers for select to authenticated
  using (public.is_event_admin(event_id));

create policy side_games_read on public.side_games for select to anon, authenticated using (public.event_visible(event_id));
create policy side_games_write on public.side_games for all to authenticated
  using (public.is_event_admin(event_id)) with check (public.is_event_admin(event_id));
create policy side_game_entries_read on public.side_game_entries for select to anon, authenticated using (public.event_visible(event_id));
create policy side_game_entries_write on public.side_game_entries for all to authenticated
  using (public.is_event_admin(event_id)) with check (public.is_event_admin(event_id));
create policy side_game_results_read on public.side_game_results for select to anon, authenticated using (public.event_visible(event_id));

-- Purses are public unless the organizer hides them.
create policy payout_tables_read on public.payout_tables for select to anon, authenticated
  using (public.is_event_admin(event_id)
         or (public.event_visible(event_id) and not (select hide_purse from public.events where id = event_id)));
create policy payout_tables_write on public.payout_tables for all to authenticated
  using (public.is_event_admin(event_id)) with check (public.is_event_admin(event_id));

revoke all on public.registration_answers from anon;
revoke insert, update, delete, truncate on public.side_game_results from anon;
revoke insert, update, delete, truncate on public.registration_answers, public.side_game_results from authenticated;
revoke insert, update, delete, truncate on public.registration_questions, public.side_games, public.side_game_entries, public.payout_tables from anon;
revoke truncate on public.registration_questions, public.side_games, public.side_game_entries, public.payout_tables from authenticated;

grant update (start_time, starting_hole, group_size, tee_interval_minutes) on public.rounds to authenticated;
grant update (registration_opens_at, waitlist_limit, show_participants, scoring_basis, net_allowances, max_handicap_index, hide_purse)
  on public.events to authenticated;

revoke execute on function
  public.event_handicaps(uuid), public.set_side_game_result(uuid, int, uuid, text),
  public.save_registration_answers(uuid, uuid, int, jsonb, boolean), public.set_registration_answers(uuid, jsonb),
  public.register_for_event(text, jsonb, text, text, jsonb), public.create_event_setup(jsonb),
  public.duplicate_event(uuid, text, date, boolean)
  from public, anon, authenticated;
grant execute on function public.event_handicaps(uuid), public.register_for_event(text, jsonb, text, text, jsonb) to anon, authenticated;
grant execute on function
  public.set_side_game_result(uuid, int, uuid, text), public.set_registration_answers(uuid, jsonb),
  public.create_event_setup(jsonb), public.duplicate_event(uuid, text, date, boolean)
  to authenticated;

alter table public.side_games replica identity full;
alter table public.side_game_results replica identity full;
alter table public.payout_tables replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.side_games, public.side_game_results, public.payout_tables;
  end if;
end $$;
