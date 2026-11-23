-- PrivacyPH schema
-- Run this in the Supabase SQL Editor (Database > SQL Editor > New query).

create extension if not exists vector;

-- ---------------------------------------------------------------
-- Corpus
-- ---------------------------------------------------------------

-- One row per legal issuance in the corpus.
create table if not exists documents (
  id            uuid primary key default gen_random_uuid(),
  short_code    text not null unique,        -- 'RA-10173', 'NPC-16-03', 'NPC-2023-06'
  title         text not null,
  issuer        text not null,               -- 'Congress', 'NPC', 'Office of the President'
  doc_type      text not null,               -- 'statute' | 'irr' | 'circular' | 'advisory' | 'eo'
  date_issued   date,
  date_in_force date,
  source_url    text not null,
  is_current    boolean not null default true,
  superseded_by text,                        -- short_code of the issuance that replaced it
  created_at    timestamptz not null default now()
);

-- Section-level chunks. One row per section of an issuance.
create table if not exists chunks (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references documents(id) on delete cascade,
  section_label text not null,               -- 'Sec. 18', 'Rule V, Sec. 11'
  heading       text,
  content       text not null,
  token_count   int,
  ordinal       int not null,                -- position within the document
  embedding     vector(1536),
  created_at    timestamptz not null default now()
);

create index if not exists chunks_document_id_idx on chunks (document_id);
create index if not exists chunks_embedding_idx
  on chunks using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------

create table if not exists conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null,
  title      text,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references conversations(id) on delete cascade,
  role                text not null check (role in ('user', 'assistant')),
  content             text not null,
  retrieved_chunk_ids uuid[],                -- provenance: what the answer was built from
  top_similarity      real,                  -- confidence proxy; drives the refusal path
  refused             boolean not null default false,
  latency_ms          int,
  created_at          timestamptz not null default now()
);

create index if not exists messages_conversation_id_idx on messages (conversation_id);

create table if not exists feedback (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  rating     smallint not null check (rating in (-1, 1)),
  comment    text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Compliance scorecard
-- ---------------------------------------------------------------

create table if not exists assessments (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users(id) on delete set null,
  org_size_bracket  text,                    -- '1-10' | '11-50' | '51-200' | '200+'
  sector            text,
  answers           jsonb not null,          -- { question_id: answer }
  dimension_scores  jsonb not null,          -- { lawfulness: 0.72, security: 0.40, ... }
  overall_score     real not null,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Retrieval RPC
-- ---------------------------------------------------------------

create or replace function match_chunks (
  query_embedding vector(1536),
  match_count     int default 8,
  min_similarity  float default 0.35
)
returns table (
  chunk_id      uuid,
  content       text,
  section_label text,
  heading       text,
  short_code    text,
  doc_title     text,
  source_url    text,
  similarity    float
)
language sql stable
as $$
  select
    c.id,
    c.content,
    c.section_label,
    c.heading,
    d.short_code,
    d.title,
    d.source_url,
    1 - (c.embedding <=> query_embedding) as similarity
  from chunks c
  join documents d on d.id = c.document_id
  where d.is_current
    and 1 - (c.embedding <=> query_embedding) > min_similarity
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- ---------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------

alter table conversations enable row level security;
alter table messages      enable row level security;
alter table feedback      enable row level security;
alter table assessments   enable row level security;

create policy "own conversations" on conversations
  for all using (auth.uid() = user_id);

create policy "own messages" on messages
  for all using (
    exists (
      select 1 from conversations
      where conversations.id = messages.conversation_id
        and conversations.user_id = auth.uid()
    )
  );

-- Feedback has no user_id of its own: it hangs off a message, which hangs off
-- a conversation. The policy has to walk that chain, or RLS is either absent
-- (anyone with the anon key reads every rating) or total (the thumbs buttons
-- fail silently, because nothing can write).
create policy "own feedback" on feedback
  for all using (
    exists (
      select 1
      from messages
      join conversations on conversations.id = messages.conversation_id
      where messages.id = feedback.message_id
        and conversations.user_id = auth.uid()
    )
  );

create policy "own assessments" on assessments
  for all using (auth.uid() = user_id);

-- Corpus is world-readable; only the service role writes to it.
alter table documents enable row level security;
alter table chunks    enable row level security;
create policy "corpus is readable" on documents for select using (true);
create policy "chunks are readable" on chunks    for select using (true);
