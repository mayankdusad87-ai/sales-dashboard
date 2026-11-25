-- Control Tower: access log. Run once in Supabase -> SQL Editor, after schema.sql. Safe to run again.
-- Records who opened the dashboard, when, and which screens. No passwords, customer details, searches, IP or location.
-- Only admins can read it. Nobody can change or delete entries from the dashboard; entries older than 180 days go away.

create table if not exists public.access_log (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  last_at timestamptz not null default now(),   -- for a visit: the last time the dashboard fetched data
  email   text not null,
  event   text not null check (event in ('signin', 'signout', 'open', 'screen')),
  screen  text,
  detail  text,
  device  text
);
create index if not exists access_log_at    on public.access_log (at desc);
create index if not exists access_log_email on public.access_log (email, at desc);

alter table public.access_log enable row level security;
drop policy if exists access_log_read on public.access_log;
create policy access_log_read on public.access_log for select to authenticated using (public.is_admin());
revoke all on public.access_log from anon, authenticated;
grant select on public.access_log to authenticated;

-- The only way in: the signed-in person's own email and the server's clock are used, never values from the browser.
-- A visit continues while data keeps being fetched (gap under 45 minutes); the same screen counts once in 5 minutes.
create or replace function public.log_access(p_event text, p_screen text default null, p_detail text default null, p_device text default null)
returns void language plpgsql security definer set search_path = public as $$
declare me text := public.my_email(); hit bigint;
begin
  if me = '' or p_event is null or p_event not in ('signin', 'signout', 'open', 'screen') then return; end if;
  if not exists (select 1 from public.members where email = me and active) then return; end if;
  p_screen := left(p_screen, 40); p_detail := left(p_detail, 80); p_device := left(p_device, 20);
  perform pg_advisory_xact_lock(hashtext('access_log:' || me));
  if p_event = 'open' then
    select id into hit from public.access_log where email = me and event = 'open' and last_at > now() - interval '45 minutes'
      and device is not distinct from p_device order by last_at desc limit 1;
    if hit is not null then update public.access_log set last_at = now() where id = hit; return; end if;
  else
    if exists (select 1 from public.access_log where email = me and event = p_event and at > now() - interval '5 minutes'
      and screen is not distinct from p_screen and detail is not distinct from p_detail) then return; end if;
  end if;
  insert into public.access_log (email, event, screen, detail, device) values (me, p_event, p_screen, p_detail, p_device);
  if random() < 0.02 then delete from public.access_log where at < now() - interval '180 days'; end if;
end $$;
revoke all on function public.log_access(text, text, text, text) from public, anon;
grant execute on function public.log_access(text, text, text, text) to authenticated;

-- One line per person for the Admin screen (admins only; others get nothing).
create or replace function public.access_summary()
returns table (email text, last_visit timestamptz, visits7 bigint, visits30 bigint, top_screen text)
language sql stable security definer set search_path = public as $$
  select m.email,
    (select max(l.last_at) from public.access_log l where l.email = m.email),
    (select count(*) from public.access_log l where l.email = m.email and l.event = 'open' and l.at > now() - interval '7 days'),
    (select count(*) from public.access_log l where l.email = m.email and l.event = 'open' and l.at > now() - interval '30 days'),
    (select l.screen from public.access_log l where l.email = m.email and l.event = 'screen' and l.at > now() - interval '30 days'
       group by l.screen order by count(*) desc limit 1)
  from public.members m where public.is_admin() order by 2 desc nulls last, m.email
$$;
revoke all on function public.access_summary() from public, anon;
grant execute on function public.access_summary() to authenticated;
