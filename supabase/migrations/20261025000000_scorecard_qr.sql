-- Scorecard QR codes: each printed card carries a link with a secret code for
-- that group in that round. Whoever holds the card can enter scores for the
-- entries in that group only, without signing in, and only while the event is
-- in progress and the round is open. The code never grants anything else: it
-- can't change the event, other groups, other rounds, or a WD/DQ entry.
--
-- The code is kept in plain form so a reprint shows the same QR, so the table
-- is closed to every client role and reachable only through the functions
-- below (admins read their own event's codes). Codes are 122 random bits.

create table public.scoring_cards (
  group_id uuid primary key,
  round_id uuid not null,
  event_id uuid not null,
  token text not null unique check (token ~ '^[0-9a-f]{32}$'),
  created_at timestamptz not null default now(),
  foreign key (group_id, event_id) references public.groups(id, event_id) on delete cascade,
  foreign key (round_id, event_id) references public.rounds(id, event_id) on delete cascade
);
alter table public.scoring_cards enable row level security;
revoke all on public.scoring_cards from anon, authenticated;

-- History shows who changed a score; card scorers have no account, so the card is the label.
create or replace function public.scores_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := coalesce(current_setting('flagstick.reason', true), '');
  v_who text := coalesce(public.current_email(), nullif(current_setting('flagstick.actor', true), ''), '');
begin
  if tg_op = 'DELETE' then
    insert into public.score_audit(event_id, round_id, entry_id, player_id, hole, action, old_strokes, new_strokes, reason, changed_by, changed_by_email)
    values (old.event_id, old.round_id, old.entry_id, old.player_id, old.hole, 'delete', old.strokes, null, v_reason, auth.uid(), v_who);
    return old;
  elsif tg_op = 'UPDATE' then
    insert into public.score_audit(event_id, round_id, entry_id, player_id, hole, action, old_strokes, new_strokes, reason, changed_by, changed_by_email)
    values (new.event_id, new.round_id, new.entry_id, new.player_id, new.hole, 'update', old.strokes, new.strokes, v_reason, auth.uid(), v_who);
  else
    insert into public.score_audit(event_id, round_id, entry_id, player_id, hole, action, old_strokes, new_strokes, reason, changed_by, changed_by_email)
    values (new.event_id, new.round_id, new.entry_id, new.player_id, new.hole, 'insert', null, new.strokes, v_reason, auth.uid(), v_who);
  end if;
  return new;
end $$;

-- Admin: the card code for every group in a round, creating any that are missing.
create or replace function public.scoring_card_codes(p_round uuid)
returns table (group_id uuid, token text) language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  select event_id into v_event from public.rounds where id = p_round;
  if v_event is null or not public.is_event_admin(v_event) then
    raise exception 'Only an event admin can print scorecard codes.' using errcode = 'PT403';
  end if;
  insert into public.scoring_cards(group_id, round_id, event_id, token)
  select g.id, g.round_id, g.event_id, replace(gen_random_uuid()::text, '-', '')
    from public.groups g where g.round_id = p_round
  on conflict on constraint scoring_cards_pkey do nothing;
  return query select c.group_id, c.token from public.scoring_cards c where c.round_id = p_round;
end $$;

-- Admin: cancel every card code in a round (a lost card); new ones are made at the next print.
create or replace function public.reset_scoring_cards(p_round uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_event uuid; n int;
begin
  select event_id into v_event from public.rounds where id = p_round;
  if v_event is null or not public.is_event_admin(v_event) then
    raise exception 'Only an event admin can reset scorecard codes.' using errcode = 'PT403';
  end if;
  delete from public.scoring_cards where round_id = p_round;
  get diagnostics n = row_count;
  perform public.log_event(v_event, 'scorecard_codes_reset', format('%s card code(s) cancelled', n));
end $$;

-- Public: which event, round and group a card code belongs to (nothing if the code is wrong).
create or replace function public.scoring_card(p_token text)
returns table (event_id uuid, round_id uuid, group_id uuid) language sql stable security definer set search_path = '' as $$
  select c.event_id, c.round_id, c.group_id from public.scoring_cards c
   join public.events e on e.id = c.event_id
   where c.token = lower(p_token) and e.status <> 'draft'
$$;

-- The checks a card scorer gets: the same as an assigned scorekeeper, limited to the card's group.
create or replace function public.assert_card_can_write(p_token text, p_entry uuid)
returns public.scoring_cards language plpgsql security definer set search_path = '' as $$
declare c public.scoring_cards; r public.rounds; v_event_status text; v_entry_status text; v_group text;
begin
  select * into c from public.scoring_cards where token = lower(p_token);
  if not found then
    raise exception 'This scorecard code isn''t valid any more. Ask the organizer for a new card.' using errcode = 'PT403';
  end if;
  if not exists (select 1 from public.group_entries where group_id = c.group_id and entry_id = p_entry) then
    raise exception 'That entry isn''t on this scorecard.' using errcode = 'PT403';
  end if;
  select * into r from public.rounds where id = c.round_id;
  select status into v_event_status from public.events where id = c.event_id;
  select status into v_entry_status from public.entries where id = p_entry;
  if r.status = 'finalized' or v_event_status = 'finalized' then
    raise exception 'Results are final. Scores can no longer be changed.' using errcode = 'PT409';
  end if;
  if v_event_status <> 'in_progress' then raise exception 'Scoring is not open for this event.' using errcode = 'PT409'; end if;
  if r.status = 'locked' then raise exception 'The round is locked.' using errcode = 'PT409'; end if;
  if v_entry_status <> 'active' then
    raise exception 'This entry is marked %; only an admin can change its scores.', upper(v_entry_status) using errcode = 'PT409';
  end if;
  select name into v_group from public.groups where id = c.group_id;
  perform set_config('flagstick.actor', 'Scorecard QR, ' || v_group, true);
  perform set_config('flagstick.reason', '', true);
  return c;
end $$;

create or replace function public.card_set_score(
  p_token text, p_entry uuid, p_hole int, p_strokes int, p_expected_version int, p_player uuid default null
) returns public.scores language plpgsql security definer set search_path = '' as $$
declare c public.scoring_cards; cur public.scores; res public.scores;
begin
  c := public.assert_card_can_write(p_token, p_entry);
  perform public.assert_score_slot(c.round_id, p_entry, p_hole, p_player);
  if p_strokes is null or p_strokes < 1 or p_strokes > 20 then
    raise exception 'A hole score must be between 1 and 20.' using errcode = 'PT400';
  end if;
  select * into cur from public.scores
   where round_id = c.round_id and entry_id = p_entry and hole = p_hole and player_id is not distinct from p_player for update;
  if not found then
    if p_expected_version is not null then
      raise exception 'CONFLICT: this score was cleared by someone else.'
        using errcode = 'PT409', detail = json_build_object('current', null)::text;
    end if;
    begin
      insert into public.scores(round_id, entry_id, event_id, player_id, hole, strokes, updated_by)
      values (c.round_id, p_entry, c.event_id, p_player, p_hole, p_strokes, null) returning * into res;
    exception when unique_violation then
      select * into cur from public.scores
       where round_id = c.round_id and entry_id = p_entry and hole = p_hole and player_id is not distinct from p_player;
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
  update public.scores set strokes = p_strokes, version = cur.version + 1, updated_at = now(), updated_by = null
   where id = cur.id returning * into res;
  return res;
end $$;

create or replace function public.card_clear_score(
  p_token text, p_entry uuid, p_hole int, p_expected_version int, p_player uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
declare c public.scoring_cards; cur public.scores;
begin
  c := public.assert_card_can_write(p_token, p_entry);
  select * into cur from public.scores
   where round_id = c.round_id and entry_id = p_entry and hole = p_hole and player_id is not distinct from p_player for update;
  if not found then return; end if;
  if p_expected_version is distinct from cur.version then
    raise exception 'CONFLICT: someone else changed this hole.'
      using errcode = 'PT409', detail = json_build_object('current', row_to_json(cur))::text;
  end if;
  delete from public.scores where id = cur.id;
end $$;

revoke execute on function
  public.scoring_card_codes(uuid), public.reset_scoring_cards(uuid), public.scoring_card(text),
  public.assert_card_can_write(text, uuid), public.card_set_score(text, uuid, int, int, int, uuid),
  public.card_clear_score(text, uuid, int, int, uuid)
  from public, anon, authenticated;
grant execute on function public.scoring_card_codes(uuid), public.reset_scoring_cards(uuid) to authenticated;
grant execute on function
  public.scoring_card(text), public.card_set_score(text, uuid, int, int, int, uuid), public.card_clear_score(text, uuid, int, int, uuid)
  to anon, authenticated;
