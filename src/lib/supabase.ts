import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Both clients are created lazily.
 *
 * Creating one at module scope means the constructor runs on import, before
 * any caller has had a chance to load environment variables — which is exactly
 * how `tsx scripts/ingest.ts` died with "supabaseUrl is required" while the
 * values sat in .env.local, unread. Static imports are hoisted, so no amount
 * of loading env at the top of a script can fix that; the fix is to not build
 * the client until something asks for it.
 */

function url(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL is not set. In a script, run it with ' +
        '--env-file=.env.local (npm run ingest already does).'
    );
  }
  return value;
}

let browserClient: SupabaseClient | null = null;

/** RLS-respecting client, for the browser and for user-scoped server reads. */
export function supabase(): SupabaseClient {
  if (!browserClient) {
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!key) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set');
    browserClient = createClient(url(), key);
  }
  return browserClient;
}

let service: SupabaseClient | null = null;

/**
 * Server-only client. Bypasses every RLS policy — never import this into code
 * that ships to the browser.
 */
export function serviceClient(): SupabaseClient {
  if (!service) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
    service = createClient(url(), key, { auth: { persistSession: false } });
  }
  return service;
}
