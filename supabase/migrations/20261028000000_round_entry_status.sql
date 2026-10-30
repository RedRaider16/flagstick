-- No-show / did-not-finish for one round. A team that played day 1 and didn't
-- show on day 2 keeps its day-1 score and ranking on the day-1 board; it is
-- unranked overall and can't be scored on day 2 except by an admin. The
-- whole-event statuses (entries.status) are unchanged and take precedence.

create table public.round_entry_status (
  round_id uuid not null,
  entry_id uuid not null,
  event_id uuid not null,
  status text not null check (status in ('dnf','ns')),
  note text not null default '' check (char_length(note) <= 200),
  set_at timestamptz not null default now(),
  primary key (round_id, entry_id),
  foreign key (round_id, event_id) references public.rounds(id, event_id) on delete cascade,
  foreign key (entry_id, event_id) references public.entries(id, event_id) on delete cascade
);
alter table public.round_entry_status enable row level security;
revoke all on public.round_entry_status from anon, authenticated;
grant select on public.round_entry_status to anon, authenticated;
create policy round_entry_status_read on public.round_entry_status for select to anon, authenticated
  using (public.event_visible(event_id));

/** Admin: mark an entry DNF or NS for one round, or clear it (p_status null). */
create or replace function public.set_round_entry_status(p_round uuid, p_entry uuid, p_status text, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare r public.rounds; v_rn int; v_old text;
begin
  select * into r from public.rounds where id = p_round;
  if not found or not public.is_event_admin(r.event_id) then raise exception 'Admins only.' using errcode = 'PT403'; end if;
  if not exists (select 1 from public.entries where id = p_entry and event_id = r.event_id) then
    raise exception 'That entry is not in this event.' using errcode = 'PT404';
  end if;
  if p_status is not null and p_status not in ('dnf','ns') then raise exception 'Unknown status.' using errcode = 'PT409'; end if;
  if r.status = 'finalized' or (select status from public.events where id = r.event_id) = 'finalized' then
    raise exception 'Results for this round are final. Reopen it first.' using errcode = 'PT409';
  end if;
  select status into v_old from public.round_entry_status where round_id = p_round and entry_id = p_entry;
  if p_status is null then
    delete from public.round_entry_status where round_id = p_round and entry_id = p_entry;
  else
    insert into public.round_entry_status(round_id, entry_id, event_id, status, note)
    values (p_round, p_entry, r.event_id, p_status, left(coalesce(p_note, ''), 200))
    on conflict (round_id, entry_id) do update set status = excluded.status, note = excluded.note, set_at = now();
  end if;
  v_rn := r.round_number;
  perform public.log_event(r.event_id, 'round_entry_status:R' || v_rn || ':' || coalesce(v_old, 'active') || '->' || coalesce(p_status, 'active'),
                           p_entry::text || coalesce(' ' || nullif(p_note, ''), ''));
end $$;

-- Scorekeepers can't score an entry marked out for that round (admins can, to correct).
create or replace function public.assert_can_write_score(p_round uuid, p_entry uuid, p_reason text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare r public.rounds; v_event_status text; v_entry_status text; v_admin boolean; v_round_status text;
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
    select status into v_round_status from public.round_entry_status where round_id = p_round and entry_id = p_entry;
    if v_round_status is not null then
      raise exception 'This entry is marked % for this round; only an admin can change its scores.', upper(v_round_status) using errcode = 'PT409';
    end if;
  end if;
  return r.event_id;
end $$;

create or replace function public.assert_card_can_write(p_token text, p_entry uuid)
returns public.scoring_cards language plpgsql security definer set search_path = '' as $$
declare c public.scoring_cards; r public.rounds; v_event_status text; v_entry_status text; v_group text; v_round_status text;
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
  select status into v_round_status from public.round_entry_status where round_id = c.round_id and entry_id = p_entry;
  if v_round_status is not null then
    raise exception 'This entry is marked % for this round; only an admin can change its scores.', upper(v_round_status) using errcode = 'PT409';
  end if;
  select name into v_group from public.groups where id = c.group_id;
  perform set_config('flagstick.actor', 'Scorecard QR, ' || v_group, true);
  perform set_config('flagstick.reason', '', true);
  return c;
end $$;

revoke execute on function public.set_round_entry_status(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_round_entry_status(uuid, uuid, text, text) to authenticated;
revoke execute on function public.assert_can_write_score(uuid, uuid, text), public.assert_card_can_write(text, uuid) from public, anon, authenticated;

alter table public.round_entry_status replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.round_entry_status;
  end if;
end $$;
