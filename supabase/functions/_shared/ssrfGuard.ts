// Shared SSRF guard: validate a URL's host (and every redirect hop) against
// private/loopback/link-local address space before fetching it server-side.

const PRIVATE_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

/** True for loopback / private / link-local / reserved IP literals. */
export function isPrivateIp(ip: string): boolean {
  const host = ip.replace(/^\[|\]$/g, "").toLowerCase();

  const v4 = ipv4ToInt(host);
  if (v4 !== null) {
    const inRange = (cidrBase: string, bits: number) => {
      const base = ipv4ToInt(cidrBase)!;
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (v4 & mask) >>> 0 === (base & mask) >>> 0;
    };
    return (
      inRange("0.0.0.0", 8) ||
      inRange("10.0.0.0", 8) ||
      inRange("100.64.0.0", 10) ||
      inRange("127.0.0.0", 8) ||
      inRange("169.254.0.0", 16) ||
      inRange("172.16.0.0", 12) ||
      inRange("192.0.0.0", 24) ||
      inRange("192.168.0.0", 16) ||
      inRange("198.18.0.0", 15) ||
      inRange("224.0.0.0", 4) ||
      inRange("240.0.0.0", 4)
    );
  }

  // IPv6
  if (host.includes(":")) {
    if (host === "::" || host === "::1") return true;
    // Unique-local (fc00::/7), link-local (fe80::/10), IPv4-mapped loopback/private.
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
    const mapped = host.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }

  return false;
}

/** True when the hostname is obviously internal or resolves to a private IP. */
export async function isBlockedHost(hostname: string): Promise<boolean> {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (PRIVATE_HOSTNAMES.has(host)) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) return true;
  if (isPrivateIp(host)) return true;

  // Resolve DNS where the runtime allows it, so a public name pointing at
  // 169.254.169.254 (DNS rebinding style) is rejected too.
  try {
    const resolve = (Deno as unknown as {
      resolveDns?: (q: string, t: string) => Promise<string[]>;
    }).resolveDns;
    if (!resolve) return false;
    const results = await Promise.allSettled([
      resolve(host, "A"),
      resolve(host, "AAAA"),
    ]);
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      for (const ip of r.value) if (isPrivateIp(ip)) return true;
    }
  } catch {
    // DNS unavailable in this runtime: fall back to the literal checks above.
  }
  return false;
}

export class SsrfBlockedError extends Error {}

/**
 * Fetch a URL following redirects manually, re-validating every hop against
 * the private-address blocklist. `redirect: "follow"` is unsafe here: a remote
 * host can 302 into internal/metadata addresses.
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  maxRedirects = 3,
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      throw new SsrfBlockedError("Invalid URL");
    }
    if (parsed.protocol !== "https:") {
      throw new SsrfBlockedError("Only https:// URLs are allowed");
    }
    if (await isBlockedHost(parsed.hostname)) {
      throw new SsrfBlockedError("URL host not allowed");
    }
    const res = await fetch(parsed.toString(), { ...init, redirect: "manual" });
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get("location");
    await res.body?.cancel().catch(() => {});
    if (!loc) return res;
    try {
      current = new URL(loc, parsed).toString();
    } catch {
      throw new SsrfBlockedError("Invalid redirect target");
    }
  }
  throw new SsrfBlockedError("Too many redirects");
}
