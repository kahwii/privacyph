-- Hybrid retrieval: dense vectors plus lexical full-text, fused by rank.
--
-- Run after schema.sql and grants.sql. Safe to re-run.
--
-- Why this exists, from the benchmark rather than from a hunch. Two questions
-- out of 33 missed, and both missed the same way:
--
--   "A breach exposed CCTV footage of our customers. What are our duties?"
--     → retrieved the CCTV circular, missed breach management.
--   "Our cloud provider stores our data in Singapore. Is that allowed?"
--     → retrieved the security circular, missed cross-border transfers.
--
-- In both, the question's vocabulary points at one domain while the governing
-- issuance sits under a legal term the question never uses. Embeddings are
-- good at paraphrase and poor at exactly this: a term that appears verbatim in
-- the provision and nowhere in the question. Lexical search is the opposite.
-- Running both and fusing the ranks covers each one's blind spot.
--
-- First attempt at this matched nothing at all. websearch_to_tsquery ANDs its
-- terms, so a whole question became a conjunction every chunk failed:
--
--   websearch_to_tsquery('english',
--     'A breach exposed CCTV footage of our customers. What are our duties?')
--     -> 'breach' & 'expos' & 'cctv' & 'footag' & 'custom' & 'duti'   ->  0 rows
--
-- The lexical CTE returned nothing for all 39 benchmark questions, the full
-- outer join degenerated to the dense side alone, and the hybrid run produced
-- results identical to dense to three decimal places. It did not fail; it
-- quietly stopped being hybrid.
--
-- or_tsquery below ORs the lexemes instead and lets ts_rank_cd rank by how
-- many of them a chunk matches and how close together they sit -- which is
-- what the fusion needs from this side: an ordering, not a filter.

-- ---------------------------------------------------------------
-- Lexical index over the same chunks, no re-embedding needed
-- ---------------------------------------------------------------

alter table chunks
  add column if not exists fts tsvector
  generated always as (
    to_tsvector('english', coalesce(heading, '') || ' ' || coalesce(content, ''))
  ) stored;

create index if not exists chunks_fts_idx on chunks using gin (fts);

-- ---------------------------------------------------------------
-- Question -> OR'd tsquery
-- ---------------------------------------------------------------

create or replace function or_tsquery (txt text)
returns tsquery
language sql immutable
as $$
  select coalesce(
    (select string_agg(quote_literal(lexeme), ' | ')
       from unnest(tsvector_to_array(to_tsvector('english', txt))) as lexeme),
    ''
  )::tsquery;
$$;

-- ---------------------------------------------------------------
-- Reciprocal Rank Fusion
-- ---------------------------------------------------------------
--
-- RRF scores a row by 1/(k + rank) in each list and sums. It uses rank rather
-- than score, which matters here: cosine similarity and ts_rank are not on the
-- same scale and cannot be added or averaged meaningfully. k = 60 is the
-- constant from the original paper; it flattens the contribution of the very
-- top ranks so one list cannot dominate on its own.

create or replace function match_chunks_hybrid (
  query_embedding vector(1536),
  query_text      text,
  match_count     int   default 8,
  min_similarity  float default 0.35,
  rrf_k           int   default 60
)
returns table (
  chunk_id      uuid,
  content       text,
  section_label text,
  heading       text,
  short_code    text,
  doc_title     text,
  source_url    text,
  similarity    float,
  dense_rank    int,
  lexical_rank  int
)
language sql stable
as $$
  with dense as (
    select
      c.id,
      1 - (c.embedding <=> query_embedding) as sim,
      row_number() over (order by c.embedding <=> query_embedding) as rnk
    from chunks c
    join documents d on d.id = c.document_id
    where d.is_current
    order by c.embedding <=> query_embedding
    limit greatest(match_count * 4, 40)
  ),
  lexical as (
    select
      c.id,
      row_number() over (
        order by ts_rank_cd(c.fts, or_tsquery(query_text)) desc
      ) as rnk
    from chunks c
    join documents d on d.id = c.document_id
    where d.is_current
      and c.fts @@ or_tsquery(query_text)
    order by ts_rank_cd(c.fts, or_tsquery(query_text)) desc
    limit greatest(match_count * 4, 40)
  ),
  fused as (
    select
      coalesce(dense.id, lexical.id) as id,
      dense.sim,
      dense.rnk as d_rank,
      lexical.rnk as l_rank,
      coalesce(1.0 / (rrf_k + dense.rnk), 0)
        + coalesce(1.0 / (rrf_k + lexical.rnk), 0) as score
    from dense
    full outer join lexical on dense.id = lexical.id
  )
  select
    c.id,
    c.content,
    c.section_label,
    c.heading,
    d.short_code,
    d.title,
    d.source_url,
    -- Report the dense similarity, not the fusion score: the confidence floor
    -- and every number in the benchmark are calibrated against cosine, and a
    -- rank-fusion score is not comparable to them. A row found only by the
    -- lexical side has no dense similarity, so it is scored on its own terms.
    coalesce(f.sim, 1 - (c.embedding <=> query_embedding)) as similarity,
    coalesce(f.d_rank, 0)::int,
    coalesce(f.l_rank, 0)::int
  from fused f
  join chunks c on c.id = f.id
  join documents d on d.id = c.document_id
  where coalesce(f.sim, 1 - (c.embedding <=> query_embedding)) > min_similarity
  order by f.score desc
  limit match_count;
$$;

grant execute on function or_tsquery(text)
  to anon, authenticated, service_role;

grant execute on function match_chunks_hybrid(vector, text, int, float, int)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------
--
-- The first version of this block counted non-null fts values. Every row
-- passed while the search itself matched nothing, because an index being
-- populated says nothing about whether queries hit it. So verify the query
-- path, with the question that exposed the bug: lexical_matches must be > 0.

with probe as (
  select 'A breach exposed CCTV footage of our customers. What are our duties?'
         as q
)
select
  (select count(*) filter (where fts is not null) from chunks) as chunks_indexed,
  (select count(*) from chunks)                                as chunks_total,
  (select or_tsquery(q)::text from probe)                      as parsed_query,
  (select count(*) from chunks, probe where fts @@ or_tsquery(q))
                                                               as lexical_matches;
