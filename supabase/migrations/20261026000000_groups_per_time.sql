-- Groups per tee time: many events send two groups off at each time (1A and 1B),
-- so a tee sheet needs the number of groups sharing each time, not just the gap.

alter table public.rounds
  add column groups_per_time int not null default 1 check (groups_per_time between 1 and 4);
grant update (groups_per_time) on public.rounds to authenticated;

-- The step-by-step setup and "copy this event" carry the new setting.
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
                              start_time, starting_hole, group_size, tee_interval_minutes, groups_per_time)
    values (v_event, n, (r->>'date')::date, nullif(r->>'tee_id', '')::uuid,
            coalesce(r->'segments', public.default_segments(coalesce((p->>'team_size')::int, 1))),
            coalesce(nullif(r->>'start_type', ''), 'tee_times'), coalesce((r->>'use_flights')::boolean, true),
            nullif(r->>'start_time', '')::time, coalesce((r->>'starting_hole')::int, 1),
            coalesce((r->>'group_size')::int, 4), coalesce((r->>'tee_interval_minutes')::int, 10),
            coalesce((r->>'groups_per_time')::int, 1));
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
                              start_time, starting_hole, group_size, tee_interval_minutes, groups_per_time)
    values (v_event, r.round_number, r.round_date + v_shift, r.tee_id, r.segments, r.start_type, r.use_flights,
            r.start_time, r.starting_hole, r.group_size, r.tee_interval_minutes, r.groups_per_time);
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
