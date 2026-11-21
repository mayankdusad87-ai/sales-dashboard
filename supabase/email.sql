-- Control Tower: scheduled management emails (Phase 2). Run once in Supabase -> SQL Editor, after schema.sql.
-- Only admins can read or change these. Safe to run again.

create table if not exists public.email_jobs (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  active       boolean not null default true,
  projects     text[] not null default '{*}',          -- '*' = all projects, including future ones
  to_list      text[] not null default '{}',
  cc_list      text[] not null default '{}',
  bcc_list     text[] not null default '{}',
  day_of_month int not null default 1 check (day_of_month between 1 and 28),
  send_hour    int not null default 9 check (send_hour between 0 and 23),   -- India time
  sections     jsonb not null default '{"decisions":true,"cards":true,"channel":true,"realisation":true}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.email_sends (
  id       bigint generated always as identity primary key,
  job_id   uuid references public.email_jobs(id) on delete set null,
  job_name text,
  at       timestamptz not null default now(),
  period   text,                 -- month reported, e.g. 2026-10
  kind     text not null,        -- 'test' or 'scheduled'
  to_count int,
  ok       boolean not null,
  error    text,
  sent_by  text
);

alter table public.email_jobs  enable row level security;
alter table public.email_sends enable row level security;

drop policy if exists email_jobs_admin  on public.email_jobs;
drop policy if exists email_sends_admin on public.email_sends;
create policy email_jobs_admin  on public.email_jobs  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy email_sends_admin on public.email_sends for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.email_jobs to authenticated;
grant select, insert on public.email_sends to authenticated;
revoke all on public.email_jobs, public.email_sends from anon;

create or replace function public.touch_updated() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists email_jobs_touch on public.email_jobs;
create trigger email_jobs_touch before update on public.email_jobs for each row execute function public.touch_updated();

-- changes to email setups appear in the same change log as people and rights
drop trigger if exists email_jobs_log on public.email_jobs;
create trigger email_jobs_log after insert or update or delete on public.email_jobs for each row execute function public.log_change();
