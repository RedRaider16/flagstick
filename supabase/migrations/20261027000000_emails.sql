-- Confirmation emails. When a registration is made, waitlisted, moved off the
-- waitlist or cancelled, a message for each player with an email address is
-- written to email_outbox in the same transaction. The send-emails Edge
-- Function sends them through the email provider and records the outcome;
-- failures are retried with a growing delay. Nothing is sent until an
-- organizer turns sending on in email_settings with a verified from-address.
-- The provider's API key lives only in the Edge Function's secrets.

create table public.email_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  from_name text not null default 'Flagstick' check (char_length(from_name) between 1 and 60),
  from_address text not null default '' check (from_address = '' or from_address ~ '^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$'),
  reply_to text not null default '' check (reply_to = '' or reply_to ~ '^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$'),
  site_url text not null default 'https://redraider16.github.io/flagstick' check (site_url ~ '^https://'),
  /** Where the database pokes the sender after queueing (null: rely on the schedule). */
  function_url text check (function_url is null or function_url ~ '^https://'),
  updated_at timestamptz not null default now()
);
insert into public.email_settings default values;

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  registration_id uuid references public.registrations(id) on delete set null,
  kind text not null check (kind in ('registered','waitlisted','promoted','cancelled')),
  to_email text not null check (to_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  to_name text not null default '',
  subject text not null check (char_length(subject) between 1 and 200),
  body text not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts int not null default 0,
  next_try_at timestamptz not null default now(),
  last_error text not null default '',
  provider_id text not null default '',
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (registration_id, kind, to_email)
);
create index email_outbox_due_idx on public.email_outbox(status, next_try_at);
create index email_outbox_event_idx on public.email_outbox(event_id, created_at desc);

alter table public.email_settings enable row level security;
alter table public.email_outbox enable row level security;
revoke all on public.email_settings, public.email_outbox from anon, authenticated;
-- Organizers see and edit the sending settings; event admins see their event's emails.
grant select, update (enabled, from_name, from_address, reply_to) on public.email_settings to authenticated;
create policy email_settings_organizers on public.email_settings for select to authenticated using (public.is_organizer());
create policy email_settings_organizers_update on public.email_settings for update to authenticated
  using (public.is_organizer()) with check (public.is_organizer());
grant select on public.email_outbox to authenticated;
create policy email_outbox_admin_read on public.email_outbox for select to authenticated using (public.is_event_admin(event_id));

-- ── Message text ───────────────────────────────────────────────────────────

create or replace function public.money_text(p_cents int)
returns text language sql immutable set search_path = '' as $$
  select '$' || case when p_cents % 100 = 0 then to_char(p_cents / 100, 'FM999,990') else to_char(p_cents / 100.0, 'FM999,990.00') end
$$;

/** Queue one kind of message for every player on a registration who gave an email. */
create or replace function public.queue_registration_email(p_reg uuid, p_kind text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  r public.registrations; e public.events; c public.courses; st public.email_settings;
  v_dates text; v_players text; v_link text; v_fee text := ''; v_subject text; v_lead text; v_n int := 0;
  p record;
begin
  select * into r from public.registrations where id = p_reg;
  if not found then return 0; end if;
  select * into e from public.events where id = r.event_id;
  if e.is_template then return 0; end if;
  select * into c from public.courses where id = e.course_id;
  select * into st from public.email_settings;
  v_link := coalesce(st.site_url, 'https://redraider16.github.io/flagstick') || '/e/' || e.public_code;
  select string_agg(to_char(rd.round_date, 'FMDay, FMMonth FMDD, YYYY'), ' and ' order by rd.round_number)
    into v_dates from public.rounds rd where rd.event_id = e.id;
  select string_agg(rp.first_name || ' ' || rp.last_name, ', ' order by rp.position)
    into v_players from public.registration_players rp where rp.registration_id = r.id;
  if e.entry_fee_cents is not null and e.entry_fee_cents > 0 then
    v_fee := 'Entry fee: ' || public.money_text(e.entry_fee_cents) || ' per player'
      || case when e.team_size > 1 then ' (' || public.money_text(e.entry_fee_cents * e.team_size) || ' per team)' else '' end || '.'
      || case when coalesce(trim(e.payment_instructions), '') <> '' then E'\n' || trim(e.payment_instructions) else '' end;
  end if;

  v_subject := case p_kind
    when 'registered' then 'You''re registered: ' || e.name
    when 'waitlisted' then 'You''re on the waitlist: ' || e.name
    when 'promoted' then 'A spot opened up. You''re in: ' || e.name
    else 'Registration cancelled: ' || e.name end;
  v_lead := case p_kind
    when 'registered' then 'You''re registered for ' || e.name || '.'
    when 'waitlisted' then 'The field for ' || e.name || ' is full, so you''re on the waitlist. We''ll email you if a spot opens up.'
    when 'promoted' then 'Good news: a spot opened up in ' || e.name || ' and you''re now in the field.'
    else 'Your registration for ' || e.name || ' has been cancelled. If that''s a mistake, reply to this email.' end;

  for p in select distinct on (lower(rp.email)) rp.first_name, rp.email from public.registration_players rp
            where rp.registration_id = r.id and rp.email <> '' order by lower(rp.email), rp.position loop
    insert into public.email_outbox(event_id, registration_id, kind, to_email, to_name, subject, body)
    values (e.id, r.id, p_kind, p.email, p.first_name, left(v_subject, 200),
      'Hi ' || p.first_name || ',' || E'\n\n' || v_lead || E'\n\n'
      || 'Confirmation number: ' || r.ref || E'\n'
      || case when coalesce(nullif(trim(r.team_name), ''), '') <> '' then 'Team: ' || trim(r.team_name) || E'\n' else '' end
      || 'Players: ' || coalesce(v_players, '') || E'\n'
      || 'When: ' || coalesce(v_dates, to_char(e.event_date, 'FMDay, FMMonth FMDD, YYYY')) || E'\n'
      || 'Where: ' || coalesce(c.name, '') || E'\n'
      || case when p_kind in ('registered','promoted') and v_fee <> '' then E'\n' || v_fee || E'\n' else '' end
      || case when p_kind = 'cancelled' then '' else E'\nTee times, pairings and live scores: ' || v_link || E'\n' end
      || E'\nSee you at the course.')
    on conflict (registration_id, kind, to_email) do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

-- ── Triggers: queue at commit, when the players are in place ──────────────

create or replace function public.registrations_email()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cur public.registrations;
begin
  select * into cur from public.registrations where id = new.id;
  if not found then return null; end if;
  if tg_op = 'INSERT' then
    perform public.queue_registration_email(cur.id, case cur.status when 'confirmed' then 'registered' when 'waitlisted' then 'waitlisted' else 'cancelled' end);
  elsif cur.created_at <> now() then -- a change made in the sign-up's own transaction isn't news
    if old.status = 'waitlisted' and new.status = 'confirmed' then perform public.queue_registration_email(cur.id, 'promoted');
    elsif new.status = 'cancelled' and old.status <> 'cancelled' then perform public.queue_registration_email(cur.id, 'cancelled');
    end if;
  end if;
  return null;
end $$;

create constraint trigger registrations_email_insert after insert on public.registrations
  deferrable initially deferred for each row execute function public.registrations_email();
create constraint trigger registrations_email_status after update of status on public.registrations
  deferrable initially deferred for each row when (old.status is distinct from new.status)
  execute function public.registrations_email();

-- Poke the sender right away when messages are queued (if pg_net is available).
create or replace function public.email_outbox_kick()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_url text;
begin
  select function_url into v_url from public.email_settings where enabled;
  if v_url is not null and to_regproc('net.http_post') is not null then
    execute 'select net.http_post(url := $1, body := ''{}''::jsonb, headers := ''{"Content-Type":"application/json"}''::jsonb)' using v_url;
  end if;
  return null;
end $$;
create trigger email_outbox_kick after insert on public.email_outbox
  for each statement execute function public.email_outbox_kick();

-- ── Sender API (service role only) ─────────────────────────────────────────

/** Take up to p_limit due messages for sending. A message stuck in 'sending' for 10 minutes is retried. */
create or replace function public.claim_emails(p_limit int default 20)
returns setof public.email_outbox language sql security definer set search_path = '' as $$
  update public.email_outbox o set status = 'sending', attempts = o.attempts + 1, next_try_at = now() + interval '10 minutes'
   where o.id in (
     select id from public.email_outbox
      where (status in ('pending','failed') and next_try_at <= now() and attempts < 6)
         or (status = 'sending' and next_try_at <= now() and attempts < 6)
      order by created_at limit greatest(1, least(p_limit, 50))
      for update skip locked)
  returning o.*
$$;

create or replace function public.finish_email(p_id uuid, p_ok boolean, p_provider_id text, p_error text)
returns void language sql security definer set search_path = '' as $$
  update public.email_outbox set
    status = case when p_ok then 'sent' else 'failed' end,
    sent_at = case when p_ok then now() else sent_at end,
    provider_id = coalesce(p_provider_id, ''),
    last_error = case when p_ok then '' else left(coalesce(p_error, 'unknown error'), 500) end,
    next_try_at = case when p_ok then next_try_at else now() + make_interval(mins => 5 * attempts * attempts) end
  where id = p_id
$$;

-- Admin: send a message again (e.g. after fixing a typo in the player's email).
create or replace function public.resend_email(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  select event_id into v_event from public.email_outbox where id = p_id;
  if v_event is null or not public.is_event_admin(v_event) then raise exception 'Admins only.' using errcode = 'PT403'; end if;
  update public.email_outbox set status = 'pending', attempts = 0, next_try_at = now(), last_error = '' where id = p_id;
end $$;

revoke execute on function
  public.money_text(int), public.queue_registration_email(uuid, text), public.registrations_email(),
  public.email_outbox_kick(), public.claim_emails(int), public.finish_email(uuid, boolean, text, text), public.resend_email(uuid)
  from public, anon, authenticated;
grant execute on function public.resend_email(uuid) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, update on public.email_settings to service_role;
    grant execute on function public.claim_emails(int), public.finish_email(uuid, boolean, text, text) to service_role;
  end if;
end $$;
