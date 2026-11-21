-- Control Tower: people, rights and change log.
-- Run once in Supabase -> SQL Editor. Safe to run again (it replaces functions, policies and triggers).
-- Nobody can sign up unless an admin has added their email to "members" first.

-- 1. Tables -------------------------------------------------------------------
create table if not exists public.members (
  email      text primary key check (email = lower(email)),
  full_name  text,
  is_admin   boolean not null default false,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- one row per person per project; project '*' = all projects, including future ones
create table if not exists public.access (
  email      text not null references public.members(email) on delete cascade on update cascade,
  project    text not null,
  management boolean not null default false,
  site_head  boolean not null default false,
  primary key (email, project)
);

create table if not exists public.audit_log (
  id     bigint generated always as identity primary key,
  at     timestamptz not null default now(),
  actor  text,
  action text,
  detail jsonb
);

-- 2. Helpers ------------------------------------------------------------------
create or replace function public.my_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where email = public.my_email() and is_admin and active)
$$;

-- 3. Row level security: people read their own row; only admins change anything --
alter table public.members   enable row level security;
alter table public.access    enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists members_read  on public.members;
drop policy if exists members_write on public.members;
create policy members_read  on public.members for select to authenticated using (email = public.my_email() or public.is_admin());
create policy members_write on public.members for all    to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists access_read  on public.access;
drop policy if exists access_write on public.access;
create policy access_read  on public.access for select to authenticated using (email = public.my_email() or public.is_admin());
create policy access_write on public.access for all    to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (public.is_admin());

-- Signed-in people may use these tables at all; the policies above decide which rows. Signed-out visitors get nothing.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.members, public.access to authenticated;
grant select on public.audit_log to authenticated;
revoke all on public.members, public.access, public.audit_log from anon;

-- 4. Change log: every change to people or rights is recorded with who made it --
create or replace function public.log_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (actor, action, detail)
  values (public.my_email(), tg_table_name || ' ' || lower(tg_op),
          case when tg_op = 'DELETE' then to_jsonb(old)
               when tg_op = 'UPDATE' then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new))
               else to_jsonb(new) end);
  return coalesce(new, old);
end $$;

drop trigger if exists members_log on public.members;
create trigger members_log after insert or update or delete on public.members for each row execute function public.log_change();
drop trigger if exists access_log on public.access;
create trigger access_log after insert or update or delete on public.access for each row execute function public.log_change();

-- 5. An admin cannot remove their own admin right or switch themselves off -------
create or replace function public.keep_self_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.email = public.my_email() and old.is_admin and
     (tg_op = 'DELETE' or new.is_admin = false or new.active = false) then
    raise exception 'You cannot remove your own admin access';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists members_keep_admin on public.members;
create trigger members_keep_admin before update or delete on public.members for each row execute function public.keep_self_admin();

-- 6. Only invited emails can create an account ---------------------------------
create or replace function public.only_invited() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.members m where m.email = lower(new.email) and m.active) then
    raise exception 'This email has not been given access to the Control Tower';
  end if;
  return new;
end $$;

drop trigger if exists only_invited on auth.users;
create trigger only_invited before insert on auth.users for each row execute function public.only_invited();
