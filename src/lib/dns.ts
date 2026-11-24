import dns, { Resolver } from 'node:dns';

/**
 * Routes this process's hostname lookups through chosen DNS servers.
 *
 * A development escape hatch, not a production setting. Leave
 * DEV_DNS_SERVERS unset — as it is everywhere except one machine — and this
 * does nothing at all.
 *
 * The first attempt at this called dns.setServers() and appeared to work. It
 * did not. Node has two independent resolution paths:
 *
 *   dns.resolve*()  c-ares, and obeys setServers()
 *   dns.lookup()    the operating system's resolver, and ignores it entirely
 *
 * fetch() goes through dns.lookup(), so setServers() changed nothing that
 * mattered; the calls that succeeded did so because the machine's own
 * resolver happened to be answering at that moment. The log line said the
 * override was active while the override was doing nothing — which is worse
 * than no log line.
 *
 * So the lookup itself is replaced with one backed by a c-ares resolver
 * pointed at the chosen servers. Patching a core module is not something to
 * do lightly; it is contained to this function, it runs only when the
 * variable is set, and the real repair is still to fix the network adapter.
 */
// Entry points apply this independently — the app through llm.ts, the eval
// and ingest scripts at their top — because each has a different module load
// order and none should have to know about the others. Patching twice would
// wrap the patch in itself, so the first call wins and the rest are no-ops.
let applied = false;

export function applyDevDnsOverride(): void {
  if (applied) return;

  const raw = process.env.DEV_DNS_SERVERS;
  if (!raw) return;

  const servers = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (!servers.length) return;

  try {
    const resolver = new Resolver();
    resolver.setServers(servers);

    const original = dns.lookup;

    // Matches the dns.lookup signature, including its optional options
    // argument, because net.connect calls it both ways.
    const patched = (
      hostname: string,
      options: unknown,
      callback?: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
    ) => {
      const cb = (typeof options === 'function' ? options : callback) as (
        err: NodeJS.ErrnoException | null,
        address?: string | { address: string; family: number }[],
        family?: number
      ) => void;

      const wantsAll =
        typeof options === 'object' && options !== null && (options as { all?: boolean }).all;

      resolver.resolve4(hostname, (err, addresses) => {
        if (err || !addresses?.length) {
          // Fall back to the operating system rather than failing outright:
          // a host this resolver cannot reach may still resolve locally.
          return (original as unknown as typeof patched)(hostname, options, callback);
        }
        if (wantsAll) {
          return cb(null, addresses.map((address) => ({ address, family: 4 })));
        }
        cb(null, addresses[0], 4);
      });
    };

    (dns as unknown as { lookup: unknown }).lookup = patched;
    (dns.promises as unknown as { lookup?: unknown }).lookup = undefined;

    applied = true;
    console.log(`[dns] lookups routed through ${servers.join(', ')} (DEV_DNS_SERVERS)`);
  } catch (err) {
    console.warn('[dns] could not apply DEV_DNS_SERVERS:', (err as Error).message);
  }
}
