-- Control Tower: a separate right for the Control Tower tab alone (without the Management tab).
-- Run once in Supabase -> SQL Editor, after schema.sql. Safe to run again.
-- Management still opens both the Control Tower and the Management tabs; nobody's access changes by running this.
alter table public.access add column if not exists control_tower boolean not null default false;
