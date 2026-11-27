-- Automatic emails: a per-person switch to leave someone out of the 1st and 15th emails while they keep dashboard access.
-- Run once in Supabase -> SQL Editor, after schema.sql. Safe to run again.
-- Everyone starts switched on, so nobody's emails change by running this.
alter table public.members add column if not exists auto_email boolean not null default true;
