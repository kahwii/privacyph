-- Answer cache.
--
-- Run after schema.sql and grants.sql. Safe to re-run.
--
-- Why this exists. Retrieval is ours and has never failed; generation is
-- rented, and on a free tier Google sheds it first when the models are busy.
-- Measured on 25 November 2026: six models, swept repeatedly for forty
-- seconds, all returning 503. No amount of retrying fixes that.
--
-- But a visitor to a portfolio link does not invent questions. They click one
-- of the four starters on the landing page, or ask the obvious thing about
-- breaches or consent. Those answers do not need to be generated again -- they
-- need to have been generated once, and kept.
--
-- What is deliberately NOT cached: a degraded answer. Storing a failure would
-- make it permanent, which is the opposite of the point.

create table if not exists answer_cache (
  -- sha256 of the normalised question, the prompt version and the retrieval
  -- mode. Changing the system prompt or switching to hybrid retrieval
  -- therefore misses every existing row rather than serving answers written
  -- under rules that no longer apply.
  fingerprint     text primary key,
  question        text        not null,
  answer          text        not null,
  citations       jsonb       not null default '[]'::jsonb,
  confidence      real,
  insufficient    boolean     not null default false,
  hits            integer     not null default 0,
  created_at      timestamptz not null default now(),
  last_served_at  timestamptz
);

create index if not exists answer_cache_created_idx on answer_cache (created_at desc);

-- Server-side only. The anon key must never read or write this table: a cached
-- answer is served by the API route, which is also where the decision not to
-- cache a failure is made.
alter table answer_cache enable row level security;

revoke all on answer_cache from anon, authenticated;
grant select, insert, update on answer_cache to service_role;

-- ---------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------

select
  (select count(*) from answer_cache)                      as cached_answers,
  (select count(*) from pg_policies
     where tablename = 'answer_cache')                     as policies,
  (select relrowsecurity from pg_class
     where relname = 'answer_cache')                       as rls_enabled;
