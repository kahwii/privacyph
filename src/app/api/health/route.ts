import { NextResponse } from 'next/server';
import { serviceClient } from '@/lib/supabase';

/**
 * Liveness check, and the thing that keeps the database awake.
 *
 * Supabase pauses a free project after a week of too little activity, and a
 * portfolio project is idle for weeks at a time by nature. The failure is
 * quiet and lands at the worst possible moment: the link sits on a resume,
 * nobody opens it for a month, and the first person who does gets a dead
 * site. Not a degraded answer -- no retrieval at all.
 *
 * A scheduled request to this route is enough to count as activity. It reads
 * one row and never touches the language model, so keeping the project alive
 * costs no generation quota. See .github/workflows/keepalive.yml.
 *
 * force-dynamic matters: cached at the edge, this would answer without ever
 * reaching Supabase, and would keep nothing awake while reporting that all
 * was well.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const started = Date.now();

  try {
    const { count, error } = await serviceClient()
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('is_current', true);

    if (error) throw new Error(error.message);

    return NextResponse.json({
      ok: true,
      currentIssuances: count ?? 0,
      latencyMs: Date.now() - started,
    });
  } catch (err) {
    // 503 rather than 500: this is the database being unreachable or asleep,
    // which is exactly what the caller is checking for, and it makes a
    // scheduled run fail loudly instead of passing on a JSON error body.
    return NextResponse.json(
      { ok: false, error: (err as Error).message, latencyMs: Date.now() - started },
      { status: 503 }
    );
  }
}
