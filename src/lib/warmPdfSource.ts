/**
 * Idle-time warm-up for remote PDF sources (Archive.org + Vedantu notes).
 *
 * Both of those hosts pay a one-time resolve cost inside `pdf-proxy`:
 *  - Archive.org: `/metadata/<id>` lookup + `ia*.us.archive.org` redirect walk
 *  - Vedantu: full object copy into the `pdf-cache` bucket
 *
 * Historically the student paid that cost *after* tapping "open", which is the
 * "Connecting to Archive.org" stall. Warming a 0-byte Range request while the
 * lesson page is idle moves the cost off the critical path — by the time the
 * reader mounts, the proxy answers from cache.
 *
 * Rules:
 *  - fire-and-forget, never throws, never blocks render
 *  - deduped per URL for the lifetime of the tab
 *  - `bytes=0-0` only: a few bytes on the wire, no data cost for the student
 *  - only runs for sources that actually benefit (archive / vedantu)
 */

const warmed = new Set<string>();

function idle(cb: () => void, timeoutMs = 3000) {
  if (typeof window === "undefined") return;
  const w = window as unknown as {
    requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number;
  };
  if (typeof w.requestIdleCallback === "function") w.requestIdleCallback(cb, { timeout: timeoutMs });
  else window.setTimeout(cb, 600);
}

/** Sources whose first byte is expensive to resolve server-side. */
export function isWarmableSource(url: string | null | undefined): boolean {
  if (!url) return false;
  return /archive\.org/i.test(url) || /prod-recordings\.vedantu\.com/i.test(url);
}

/**
 * Warm a proxied PDF URL. `proxiedUrl` must already be a pdf-proxy URL
 * carrying the caller's access token (see `pdfViewerUrl.ts`) — we never
 * attach credentials to a third-party host here.
 */
export function warmPdfSource(proxiedUrl: string | null | undefined, sourceUrl?: string | null) {
  if (!proxiedUrl) return;
  if (!isWarmableSource(sourceUrl ?? proxiedUrl)) return;
  if (warmed.has(proxiedUrl)) return;
  warmed.add(proxiedUrl);
  idle(() => {
    try {
      void fetch(proxiedUrl, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        // Keep it cheap and cancellable; failures are irrelevant.
        cache: "no-store",
      })
        .then((res) => res.body?.cancel().catch(() => undefined))
        .catch(() => undefined);
    } catch {
      /* noop */
    }
  });
}

/** Test helper — clears the per-tab dedupe set. */
export function __resetWarmPdfSource() {
  warmed.clear();
}
