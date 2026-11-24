import { NextRequest, NextResponse } from 'next/server';
import { retrieve, rerank, supersessions } from '@/lib/retrieval';
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  REFUSAL,
  smallTalkReply,
  sourcesOnlyAnswer,
  stripInsufficientMarker,
  citesSomething,
} from '@/lib/prompt';
import { generate } from '@/lib/llm';
import { serviceClient } from '@/lib/supabase';

const CONFIDENCE_FLOOR = 0.45;

export async function POST(req: NextRequest) {
  const started = Date.now();

  let question: string;
  let conversationId: string | null = null;
  try {
    const body = await req.json();
    question = String(body.question ?? '').trim();
    conversationId = body.conversationId ?? null;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 });
  }
  if (question.length > 2000) {
    return NextResponse.json({ error: 'question is too long' }, { status: 400 });
  }

  // Answer courtesies directly. No embedding, no model call, no quota spent.
  const pleasantry = smallTalkReply(question);
  if (pleasantry) {
    return NextResponse.json({
      answer: pleasantry,
      citations: [],
      refused: false,
      smallTalk: true,
    });
  }

  try {
    const [chunks, superseded] = await Promise.all([
      retrieve(question).then((c) => rerank(question, c)),
      supersessions(),
    ]);
    const topSimilarity = chunks[0]?.similarity ?? 0;

    // The refusal path is a feature: a confident wrong answer about a legal
    // deadline is worse than no answer.
    const refused = chunks.length === 0 || topSimilarity < CONFIDENCE_FLOOR;

    let answer: string;
    let degraded = false;
    let insufficient = false;

    if (refused) {
      answer = REFUSAL;
    } else {
      try {
        const raw = await generate(SYSTEM_PROMPT, buildUserPrompt(question, chunks, superseded));
        const parsed = stripInsufficientMarker(raw);
        answer = parsed.text;
        insufficient = parsed.insufficient;
      } catch (err) {
        // Retrieval succeeded; only the summariser is down. Serve the
        // provisions rather than an error — they are what the user came for.
        console.warn('[chat] generation unavailable, serving sources only:', (err as Error).message);
        answer = sourcesOnlyAnswer(chunks);
        degraded = true;
      }
    }

    // No citations on a non-answer: a Sources list under "I do not have
    // this" reads as support for a claim that was never made.
    //
    // Three conditions, because the first two can be missed. The floor and the
    // marker are what the system intended; citesSomething is what the model
    // actually produced, and it is the only one of the three that cannot be
    // forgotten by a model having an off day. See the note on citesSomething.
    const ungrounded = !citesSomething(answer);
    const citations =
      refused || insufficient || ungrounded
        ? []
        : chunks.slice(0, 4).map((c) => ({
            shortCode: c.short_code,
            section: c.section_label,
            title: c.doc_title,
            url: c.source_url,
            similarity: Number(c.similarity.toFixed(3)),
          }));

    await log({
      conversationId,
      question,
      answer,
      chunkIds: chunks.map((c) => c.chunk_id),
      topSimilarity,
      refused,
      latencyMs: Date.now() - started,
    });

    return NextResponse.json({
      answer,
      citations,
      refused,
      insufficient: insufficient || ungrounded,
      degraded,
      confidence: Number(topSimilarity.toFixed(3)),
    });
  } catch (err) {
    console.error('[chat]', err);

    // Distinguish "the model is unavailable" from "the system is broken". The
    // first is temporary and the user can simply try again; telling them
    // something went wrong invites them to go looking for their own mistake.
    const message = (err as Error).message ?? '';
    const transient =
      /503|429|high demand|quota|timeout|aborted|every generation model failed/i.test(message) ||
      // Network-level failures: DNS, refused connection, dropped socket.
      /fetch failed|ENOTFOUND|EAI_AGAIN|ENOENT|ECONNREFUSED|ECONNRESET|getaddrinfo|network/i.test(
        message + ' ' + String((err as { cause?: { code?: string } })?.cause?.code ?? '')
      );

    const offline = /fetch failed|ENOTFOUND|EAI_AGAIN|ENOENT|getaddrinfo/i.test(
      message + ' ' + String((err as { cause?: { code?: string } })?.cause?.code ?? '')
    );

    return NextResponse.json(
      {
        error: transient
          ? offline
            ? 'Could not reach the model — the connection dropped. Check your internet and ask again.'
            : 'The model is busy right now. This is a free-tier limit, not your setup. Ask again in a moment.'
          : 'Something went wrong on the server. The dev server log has the detail.',
        transient,
      },
      { status: transient ? 503 : 500 }
    );
  }
}

async function log(entry: {
  conversationId: string | null;
  question: string;
  answer: string;
  chunkIds: string[];
  topSimilarity: number;
  refused: boolean;
  latencyMs: number;
}) {
  if (!entry.conversationId) return;
  try {
    const db = serviceClient();
    await db.from('messages').insert([
      {
        conversation_id: entry.conversationId,
        role: 'user',
        content: entry.question,
      },
      {
        conversation_id: entry.conversationId,
        role: 'assistant',
        content: entry.answer,
        retrieved_chunk_ids: entry.chunkIds,
        top_similarity: entry.topSimilarity,
        refused: entry.refused,
        latency_ms: entry.latencyMs,
      },
    ]);
  } catch (err) {
    // Logging must never break the answer.
    console.error('[chat:log]', err);
  }
}
