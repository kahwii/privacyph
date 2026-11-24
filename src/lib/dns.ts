import { setServers, getServers } from 'node:dns';

/**
 * Overrides the DNS resolvers this Node process uses.
 *
 * A development escape hatch, not a production setting. Windows resolves
 * through whichever adapter wins on interface metric, and a dead resolver on
 * a virtual adapter — the kind VirtualBox and network simulators leave behind
 * — takes the whole process down with it even when the machine's actual
 * connection is fine. On the machine this was written on, Wi-Fi resolved
 * correctly through 1.1.1.1 while an "Ethernet 2" adapter pointed at a
 * resolver that answered nothing, and every outbound call failed with
 * ENOENT on getaddrinfo.
 *
 * Fixing the adapter is the real repair; this only stops a broken resolver
 * from blocking local work. Leave DEV_DNS_SERVERS unset everywhere else, and
 * it does nothing at all.
 */
export function applyDevDnsOverride(): void {
  const raw = process.env.DEV_DNS_SERVERS;
  if (!raw) return;

  const servers = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!servers.length) return;

  try {
    setServers(servers);
    console.log(`[dns] resolving through ${getServers().join(', ')} (DEV_DNS_SERVERS)`);
  } catch (err) {
    console.warn('[dns] could not apply DEV_DNS_SERVERS:', (err as Error).message);
  }
}
