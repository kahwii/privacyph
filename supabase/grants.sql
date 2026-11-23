-- Table privileges for the Data API roles.
--
-- Run this in the Supabase SQL Editor after schema.sql.
--
-- Why it is needed: RLS decides WHICH ROWS a role may touch, but it cannot
-- grant access to the table in the first place. Those are two separate layers,
-- and "permission denied for table X" is the lower one talking. A new project
-- using the sb_secret_ / sb_publishable_ key pair can end up with policies in
-- place and no table grants behind them, which looks like an RLS problem and
-- is not.
--
-- Safe to re-run.

-- ---------------------------------------------------------------
-- Diagnostic: who am I, and what can each role see?
-- ---------------------------------------------------------------

select current_user as running_as, session_user;

select grantee, table_name, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated', 'service_role')
group by grantee, table_name
order by table_name, grantee;

-- ---------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;

-- The service role does the ingest and the server-side retrieval. It is meant
-- to bypass RLS entirely, so it needs full table access.
grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;

-- The corpus is public to read. RLS policies already restrict this to rows
-- where is_current, and the browser never writes to it.
grant select on documents, chunks to anon, authenticated;

-- A signed-in user works with their own conversations. The RLS policies
-- written in schema.sql are what confine them to their own rows.
grant select, insert, update, delete
  on conversations, messages, feedback, assessments
  to authenticated;

-- Retrieval is called server-side, but granting execute to the browser roles
-- costs nothing: the function only reads chunks, which are already readable.
grant execute on function match_chunks(vector, int, float)
  to anon, authenticated, service_role;

-- Anything created later inherits the same shape, so this does not have to be
-- rediscovered the next time a table is added.
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant all on sequences to service_role;

-- ---------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------

select grantee, table_name, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated', 'service_role')
group by grantee, table_name
order by table_name, grantee;
