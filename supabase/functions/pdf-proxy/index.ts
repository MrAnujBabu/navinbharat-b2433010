import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const DRIVE_ID_RE = /^[a-zA-Z0-9_-]{10,200}$/;
// Hardening cap for generic allow-listed CDN proxy only. Drive PDFs are streamed
// without a size ceiling because large lecture PDFs commonly exceed 80 MB.
const DIRECT_URL_MAX_BYTES = 80 * 1024 * 1024; // 80 MB
const UPSTREAM_TIMEOUT_MS = 45_000;
// Archive.org scan nodes are deliberately throttled. A 512 KB Range can take
// longer than the generic 45s budget, and aborting the response body midway
// makes pdf.js report "file download was cut short". Keep this archive-only so
// every other proxy source retains the tighter failure budget.
const ARCHIVE_UPSTREAM_TIMEOUT_MS = 90_000;
// Drive throttles large PDFs (>50 MB) to ~1 MB/s; a 120s cap was clipping
// streams mid-flight → pdf.js received a truncated body → onLoadSuccess never
// fired → "Opening … 90%" stall. Give the streaming phase more headroom while
// staying under Deno Deploy's 400 s wall-clock ceiling for edge functions.
const DRIVE_UPSTREAM_TIMEOUT_MS = 300_000;

// Phase B: Drive PDF cache in Supabase Storage.
// First request pulls from Drive AND streams a copy into pdf-cache/drive/<id>.pdf.
// Subsequent requests get a 302 redirect to a signed URL served by Supabase's
// CDN with proper Range request support — pdf.js can render page 1 in seconds
// instead of waiting for the whole Drive throttled stream.
const CACHE_BUCKET = "pdf-cache";
// 30 min signed URL. The redirect Location is a bearer-style URL that anyone
// can replay, so it must outlive a reading session but not a school day —
// 6h made paid notes trivially shareable past the enrollment gate.
const CACHE_SIGNED_URL_TTL = 60 * 30;

const headersWithCors = (extra: HeadersInit = {}) => ({
  ...corsHeaders,
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range, x-supabase-api-version, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers": "content-length, content-range, accept-ranges, content-type, cache-control, cache-tag, x-pdf-total-bytes",
  // pdf.js makes many Range requests for a large scan. Cache the successful
  // preflight so mobile browsers do not add an OPTIONS round-trip per chunk.
  "Access-Control-Max-Age": "86400",
  ...extra,
});

// AbortSignal.timeout polyfill (Deno Deploy has it, but be explicit so the
// behavior is identical across runtimes).
const timeoutSignal = (ms: number): AbortSignal => {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(new Error(`Upstream timeout after ${ms}ms`)), ms);
  return ctrl.signal;
};

const isOversize = (res: Response): boolean => {
  const len = Number(res.headers.get("content-length") || "0");
  return Number.isFinite(len) && len > DIRECT_URL_MAX_BYTES;
};

// Fire-and-forget metrics insert. We never await this — the reader's
// perceived latency must not depend on Postgres. If SUPABASE_URL /
// service-role key aren't present (local dev), we skip silently.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const adminClient = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

// AUTH: pdf-proxy streams paid course PDFs, so every request needs a valid
// session. pdf.js loads the URL inside an <iframe>/worker that cannot set
// request headers, so the JWT may arrive either in the Authorization header
// or as a `?token=` query param.
async function authenticate(req: Request): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  let token = "";
  const authHeader = req.headers.get("Authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    token = authHeader.slice(7).trim();
  }
  if (!token) token = new URL(req.url).searchParams.get("token") || "";
  if (!token) return null;
  try {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

// Mirror the lesson_pdfs SELECT RLS: staff bypass, else the drive id must map
// to a free/preview lesson or a course the caller is actively enrolled in.
async function authorizeDrive(userId: string, driveId: string): Promise<boolean> {
  if (!adminClient) return false;
  const { data: roles } = await adminClient
    .from("user_roles").select("role").eq("user_id", userId).in("role", ["admin", "teacher"]);
  if (roles && roles.length > 0) return true;

  const like = `%${driveId}%`;
  const lessonIds = new Set<string>();
  const courseIds = new Set<number>();

  const { data: lp } = await adminClient
    .from("lesson_pdfs").select("lesson_id").or(`drive_id.eq.${driveId},file_url.ilike.${like}`);
  lp?.forEach((r) => { if (r.lesson_id) lessonIds.add(r.lesson_id as string); });

  const { data: nt } = await adminClient
    .from("notes").select("lesson_id").ilike("pdf_url", like);
  nt?.forEach((r) => { if (r.lesson_id) lessonIds.add(r.lesson_id as string); });

  const { data: mt } = await adminClient
    .from("materials").select("course_id").ilike("file_url", like);
  mt?.forEach((r) => { if (r.course_id != null) courseIds.add(r.course_id as number); });

  const { data: lc } = await adminClient
    .from("lessons").select("course_id, is_free, is_preview").ilike("class_pdf_url", like);
  for (const r of lc ?? []) {
    if (r.is_free || r.is_preview) return true;
    if (r.course_id != null) courseIds.add(r.course_id as number);
  }

  if (lessonIds.size > 0) {
    const { data: ls } = await adminClient
      .from("lessons").select("course_id, is_free, is_preview").in("id", [...lessonIds]);
    for (const r of ls ?? []) {
      if (r.is_free || r.is_preview) return true;
      if (r.course_id != null) courseIds.add(r.course_id as number);
    }
  }

  if (courseIds.size === 0) return false;

  const { data: enr } = await adminClient
    .from("enrollments").select("course_id")
    .eq("user_id", userId).eq("status", "active").in("course_id", [...courseIds]);
  return !!(enr && enr.length > 0);
}

// Same enrollment gate as authorizeDrive, but for CDN-hosted PDFs.
// Resolves the target URL back to its owning lesson/course by matching
// lesson_pdfs.file_url / notes.pdf_url / materials.file_url / lessons.class_pdf_url,
// then allows staff / free lesson / active enrollment.
async function authorizeUrl(userId: string, url: string): Promise<boolean> {
  if (!adminClient) return false;
  const { data: roles } = await adminClient
    .from("user_roles").select("role").eq("user_id", userId).in("role", ["admin", "teacher"]);
  if (roles && roles.length > 0) return true;

  // URL-encoding drift: admins paste links containing literal spaces
  // ("…/Suffer English /file.pdf") into the DB, while the browser/pdf.js sends
  // the percent-encoded form ("…/Suffer%20English%20/file.pdf"). A plain
  // .eq() then never matches → false "Not authorized for this file".
  // Match every equivalent spelling instead. (.in() stays parameterized, so
  // there's no PostgREST filter-injection risk.)
  const urlVariants = (() => {
    const set = new Set<string>([url]);
    // Decode repeatedly: some callers double-encode ("%2520" → "%20" → " ").
    let cur = url;
    for (let i = 0; i < 3; i++) {
      let next: string;
      try { next = decodeURIComponent(cur); } catch { break; }
      if (next === cur) break;
      cur = next;
      set.add(cur);
      try { set.add(encodeURI(cur)); } catch { /* ignore */ }
    }
    try { set.add(encodeURI(url)); } catch { /* ignore */ }
    // Google Docs/Sheets/Slides are stored as the shareable `/edit` link but
    // proxied as `/export?format=pdf`; archive.org items are stored as
    // `/details/<id>` but proxied as a download URL. Add the canonical stored
    // spellings so the enrollment lookup still resolves.
    const g = url.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]+)/);
    if (g) {
      const base = `https://docs.google.com/${g[1]}/d/${g[2]}`;
      for (const suffix of ["/edit", "/view", "/preview", "", "/edit?usp=sharing", "/edit?usp=drivesdk", "/edit?usp=drive_link"]) {
        set.add(`${base}${suffix}`);
      }
    }
    const a = url.match(/archive\.org\/(?:details|download)\/([^/?#]+)/i);
    if (a) {
      set.add(`https://archive.org/details/${a[1]}`);
      set.add(`https://archive.org/download/${a[1]}`);
    }
    return [...set];
  })();



  const lessonIds = new Set<string>();
  const courseIds = new Set<number>();

  const { data: lp } = await adminClient
    .from("lesson_pdfs").select("lesson_id").in("file_url", urlVariants);
  lp?.forEach((r) => { if (r.lesson_id) lessonIds.add(r.lesson_id as string); });

  const { data: nt } = await adminClient
    .from("notes").select("lesson_id").in("pdf_url", urlVariants);
  nt?.forEach((r) => { if (r.lesson_id) lessonIds.add(r.lesson_id as string); });

  const { data: mt } = await adminClient
    .from("materials").select("course_id").in("file_url", urlVariants);
  mt?.forEach((r) => { if (r.course_id != null) courseIds.add(r.course_id as number); });

  // study_materials — admin uploads a Drive/CDN link here (external_url) or a
  // storage-hosted file (file_url). Without these lookups the enrollment
  // resolver falls through to "courseIds empty → deny", which was breaking
  // every jsDelivr-hosted lecture PDF added via the Study Materials admin.
  // SECURITY: use two parameterized queries instead of interpolating
  // user input into an .or() filter string — a comma in the URL would inject
  // extra PostgREST conditions and let a caller bypass the enrollment gate.
  const [smExt, smFile] = await Promise.all([
    adminClient.from("study_materials").select("course_id").in("external_url", urlVariants),
    adminClient.from("study_materials").select("course_id").in("file_url", urlVariants),
  ]);
  smExt.data?.forEach((r) => { if (r.course_id != null) courseIds.add(r.course_id as number); });
  smFile.data?.forEach((r) => { if (r.course_id != null) courseIds.add(r.course_id as number); });

  // lesson_attachments — enrolled-user-visible chip attachments.
  const { data: la } = await adminClient
    .from("lesson_attachments").select("lesson_id").in("file_url", urlVariants);
  la?.forEach((r) => { if (r.lesson_id) lessonIds.add(r.lesson_id as string); });

  const { data: lc } = await adminClient
    .from("lessons").select("course_id, is_free, is_preview").in("class_pdf_url", urlVariants);

  for (const r of lc ?? []) {
    if (r.is_free || r.is_preview) return true;
    if (r.course_id != null) courseIds.add(r.course_id as number);
  }

  // Knowledge-Hub style lessons keep the document link in `video_url` (the
  // admin uploader writes there for non-video lecture types). Without this
  // lookup every Google Docs/Sheets/CDN link stored that way resolves to
  // "courseIds empty → deny" and the reader shows a generic load failure.
  const { data: lv } = await adminClient
    .from("lessons").select("course_id, is_free, is_preview").in("video_url", urlVariants);

  for (const r of lv ?? []) {
    if (r.is_free || r.is_preview) return true;
    if (r.course_id != null) courseIds.add(r.course_id as number);
  }

  if (lessonIds.size > 0) {
    const { data: ls } = await adminClient
      .from("lessons").select("course_id, is_free, is_preview").in("id", [...lessonIds]);
    for (const r of ls ?? []) {
      if (r.is_free || r.is_preview) return true;
      if (r.course_id != null) courseIds.add(r.course_id as number);
    }
  }

  // Unknown URL — not tied to any paid content row. Deny by default so
  // the proxy can't be used to bypass future paywalls; add explicit rows
  // if a URL needs to be freely accessible.
  if (courseIds.size === 0) return false;

  const { data: enr } = await adminClient
    .from("enrollments").select("course_id")
    .eq("user_id", userId).eq("status", "active").in("course_id", [...courseIds]);
  return !!(enr && enr.length > 0);
}

const metricsClient = adminClient;

// Note: bucket file-size limit is enforced project-wide by Supabase Storage
// (default 50 MiB on managed projects). We cap the tee-upload at 48 MB
// (see cacheDriveBodyInBackground) and rely on the Supabase edge CDN for
// bigger PDFs — the immutable Cache-Control we set on Drive responses is
// enough for ~10× repeat-open speedup.
const bootstrapAttempted = true;
async function ensureCacheBucketConfigured() { void bootstrapAttempted; }



function recordMetric(row: { event: string; drive_id?: string | null; tier?: string | null; last_status?: number | null; last_content_type?: string | null }) {
  if (!metricsClient) return;
  // Never let a logging failure surface to the caller.
  try {
    Promise.resolve(metricsClient.from("pdf_proxy_metrics").insert(row))
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.warn("[pdf-proxy:metrics]", error.message);
      })
      .catch((err: unknown) => console.warn("[pdf-proxy:metrics]", err));
  } catch (err) { console.warn("[pdf-proxy:metrics]", err); }
}

/**
 * Try to short-circuit a Drive request by redirecting to a signed URL in the
 * pdf-cache bucket. Returns a 302 Response on cache hit, null on miss.
 */
async function tryCacheRedirect(driveId: string): Promise<Response | null> {
  if (!adminClient) return null;
  const path = `drive/${driveId}.pdf`;
  try {
    // HEAD-style existence check via createSignedUrl — cheap, no download.
    // Supabase returns 400/404 in `error` when the object is missing.
    const { data, error } = await adminClient.storage
      .from(CACHE_BUCKET)
      .createSignedUrl(path, CACHE_SIGNED_URL_TTL);
    if (error || !data?.signedUrl) return null;
    recordMetric({ event: "drive_cache_hit", drive_id: driveId, tier: "cache", last_status: 302 });
    return new Response(null, {
      status: 302,
      headers: headersWithCors({
        Location: data.signedUrl,
        "Cache-Control": "public, max-age=300",
        "X-Pdf-Cache": "hit",
      }),
    });
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget: buffer the tee'd Drive response body and upload to
 * pdf-cache. Runs concurrently with the streaming response to the browser.
 * Uses EdgeRuntime.waitUntil so Supabase keeps the worker alive after the
 * response stream ends — otherwise the tee upload gets killed mid-flight.
 */
function cacheDriveBodyInBackground(driveId: string, bodyStream: ReadableStream<Uint8Array>, contentType: string) {
  if (!adminClient) return;
  const path = `drive/${driveId}.pdf`;
  const work = (async () => {
    try {
      const reader = bodyStream.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      // Supabase Storage enforces a project-level per-object cap (default
      // 50 MiB on managed projects). Skip caching when a PDF would exceed
      // that — the Supabase edge CDN already gives a ~10× speedup on repeat
      // opens for larger PDFs via the immutable Cache-Control we set below.
      const MAX = 48 * 1024 * 1024;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > MAX) { console.warn("[pdf-proxy:cache] oversize, skipping", driveId, total); return; }
          chunks.push(value);
        }
      }
      // Concatenate to a single Uint8Array backed by a plain ArrayBuffer so
      // Blob's typings accept it (Deno's Uint8Array<ArrayBufferLike> otherwise
      // trips `SharedArrayBuffer is missing…`).
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) { merged.set(c, offset); offset += c.byteLength; }
      const blob = new Blob([merged], { type: contentType || "application/pdf" });
      const { error } = await adminClient.storage.from(CACHE_BUCKET).upload(path, blob, {
        contentType: contentType || "application/pdf",
        upsert: true,
        cacheControl: "31536000",
      });
      if (error) {
        console.warn("[pdf-proxy:cache] upload failed", driveId, error.message);
      } else {
        console.info("[pdf-proxy:cache] stored", driveId, total);
        recordMetric({ event: "drive_cache_store", drive_id: driveId, tier: "cache", last_status: 200 });
      }
    } catch (err) {
      console.warn("[pdf-proxy:cache] tee error", driveId, (err as Error).message);
    }
  })();
  try {
    (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } })
      .EdgeRuntime?.waitUntil(work);
  } catch { /* no waitUntil available (local Deno run) — work still runs, may be killed */ }
}

// ---------------------------------------------------------------------------
// Remote-URL cache (kind=url). Same Storage bucket as the Drive cache, but
// keyed by a hash of the source URL. Only hosts that serve immutable object
// URLs are eligible — a mutable CDN path would go stale.
//
// Why: Vedantu lecture notes (prod-recordings.vedantu.com) send no CORS
// headers, so every byte has to be relayed through this function. pdf.js
// issues dozens of Range requests per document and each one paid a full
// cold round-trip. After the first open the object lives in pdf-cache and we
// 302 to a signed Supabase CDN URL with native Range support.
// ---------------------------------------------------------------------------
const CACHEABLE_REMOTE_HOSTS = [
  /^prod-recordings\.vedantu\.com$/i,
];

function isCacheableRemote(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return CACHEABLE_REMOTE_HOSTS.some((re) => re.test(host));
  } catch {
    return false;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** pdf-cache object path for an allow-listed immutable remote URL. */
async function remoteCachePath(url: string): Promise<string> {
  return `remote/${await sha256Hex(url)}.pdf`;
}

/** Signed-URL redirect when the remote object is already cached; null on miss. */
async function tryRemoteCacheRedirect(url: string): Promise<Response | null> {
  if (!adminClient) return null;
  try {
    const path = await remoteCachePath(url);
    const { data, error } = await adminClient.storage
      .from(CACHE_BUCKET)
      .createSignedUrl(path, CACHE_SIGNED_URL_TTL);
    if (error || !data?.signedUrl) return null;
    recordMetric({ event: "remote_cache_hit", tier: "cache", last_status: 302 });
    return new Response(null, {
      status: 302,
      headers: headersWithCors({
        Location: data.signedUrl,
        "Cache-Control": "public, max-age=300",
        "X-Pdf-Cache": "hit",
      }),
    });
  } catch {
    return null;
  }
}

// De-dupe concurrent warm-ups per isolate: pdf.js fires many Range requests
// at once and each one would otherwise start its own full download.
const remoteWarmups = new Set<string>();

/**
 * Fire-and-forget: download the full remote object once and store it in
 * pdf-cache so later opens are served from the Supabase CDN. Never blocks or
 * affects the response being streamed to the caller.
 */
function warmRemoteCacheInBackground(url: string) {
  if (!adminClient) return;
  if (remoteWarmups.has(url)) return;
  remoteWarmups.add(url);
  const work = (async () => {
    try {
      const path = await remoteCachePath(url);
      // Already stored by another isolate — nothing to do.
      const existing = await adminClient.storage.from(CACHE_BUCKET).createSignedUrl(path, 60);
      if (!existing.error && existing.data?.signedUrl) return;

      const res = await fetchRemoteFile(url, null, UPSTREAM_TIMEOUT_MS);
      if (!res.ok || !res.body) {
        await res.body?.cancel().catch(() => {});
        return;
      }
      const MAX = 48 * 1024 * 1024;
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > MAX) {
          await reader.cancel().catch(() => {});
          console.warn("[pdf-proxy:remote-cache] oversize, skipping", total);
          return;
        }
        chunks.push(value);
      }
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) { merged.set(c, offset); offset += c.byteLength; }
      // Only cache real PDFs.
      if (total < 5 || new TextDecoder().decode(merged.subarray(0, 5)) !== "%PDF-") return;
      const blob = new Blob([merged], { type: "application/pdf" });
      const { error } = await adminClient.storage.from(CACHE_BUCKET).upload(path, blob, {
        contentType: "application/pdf",
        upsert: true,
        cacheControl: "31536000",
      });
      if (error) console.warn("[pdf-proxy:remote-cache] upload failed", error.message);
      else recordMetric({ event: "remote_cache_store", tier: "cache", last_status: 200 });
    } catch (err) {
      console.warn("[pdf-proxy:remote-cache]", (err as Error).message);
    } finally {
      remoteWarmups.delete(url);
    }
  })();
  try {
    (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } })
      .EdgeRuntime?.waitUntil(work);
  } catch { /* local run */ }
}

// ---------------------------------------------------------------------------
// Shared Archive.org resolve cache. The per-isolate map below still fronts
// this, but a cold isolate used to re-run /metadata AND re-walk the download
// redirect chain on the very first Range request — the visible "Connecting to
// Archive.org" stall. Persisting the resolved CDN node in the same bucket
// makes that cost a one-time, project-wide event.
// ---------------------------------------------------------------------------
const ARCHIVE_SHARED_TTL_MS = 6 * 60 * 60 * 1000; // 6h — node URLs rotate slowly

async function readSharedArchiveNode(itemId: string): Promise<string | null> {
  if (!adminClient) return null;
  try {
    const { data, error } = await adminClient.storage
      .from(CACHE_BUCKET)
      .download(`resolve/archive/${itemId}.json`);
    if (error || !data) return null;
    const parsed = JSON.parse(await data.text()) as { nodeUrl?: string; storedAt?: number };
    if (!parsed?.nodeUrl || !parsed.storedAt) return null;
    if (Date.now() - parsed.storedAt > ARCHIVE_SHARED_TTL_MS) return null;
    if (!isAllowedPdfUrl(parsed.nodeUrl)) return null;
    return parsed.nodeUrl;
  } catch {
    return null;
  }
}

function writeSharedArchiveNode(itemId: string, nodeUrl: string): void {
  if (!adminClient) return;
  const work = adminClient.storage.from(CACHE_BUCKET).upload(
    `resolve/archive/${itemId}.json`,
    new Blob([JSON.stringify({ nodeUrl, storedAt: Date.now() })], { type: "application/json" }),
    { contentType: "application/json", upsert: true, cacheControl: "0" },
  ).then(({ error }: { error: { message: string } | null }) => {
    if (error) console.warn("[pdf-proxy:archive-cache]", error.message);
  }).catch((err: unknown) => console.warn("[pdf-proxy:archive-cache]", err));
  try {
    (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } })
      .EdgeRuntime?.waitUntil(work as unknown as Promise<unknown>);
  } catch { /* local run */ }
}

function dropSharedArchiveNode(itemId: string): void {
  if (!adminClient) return;
  adminClient.storage.from(CACHE_BUCKET)
    .remove([`resolve/archive/${itemId}.json`])
    .catch(() => {});
}



Deno.serve(async (req) => {
  // Best-effort one-time bucket config (fire-and-forget; no await).
  ensureCacheBucketConfigured();
  // Admin-managed PDF host allowlist (cached 60s; no per-request DB hit).
  await refreshDynamicPdfHosts();


  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: headersWithCors() });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: headersWithCors({ "Content-Type": "application/json" }),
    });
  }

  try {
    const input = new URL(req.url);
    const kind = input.searchParams.get("kind");
    const id = input.searchParams.get("id") || "";

    // Require a valid session for every proxied fetch (paid course content).
    const userId = await authenticate(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: headersWithCors({ "Content-Type": "application/json" }),
      });
    }


    // kind=archive → archive.org item. Resolve the item's first PDF file via
    // the public metadata API, then stream it through the same guarded path.
    if (kind === "archive") {
      const itemId = input.searchParams.get("id") || "";
      const original = input.searchParams.get("url") || `https://archive.org/details/${itemId}`;
      if (!/^[A-Za-z0-9._-]{1,120}$/.test(itemId)) {
        return new Response(JSON.stringify({ error: "Invalid archive.org item id" }), {
          status: 400,
          headers: headersWithCors({ "Content-Type": "application/json" }),
        });
      }
      if (!(await authorizeUrl(userId, original))) {
        return new Response(JSON.stringify({ error: "Not authorized for this file" }), {
          status: 403,
          headers: headersWithCors({ "Content-Type": "application/json" }),
        });
      }
      // Try the resolved datanode URLs in order. A cached node can go stale
      // (node rotation / expiry) and archive.org's `/download/` redirector is
      // frequently 503 — so a failure on one candidate must fall through to
      // the next instead of surfacing a bare 500 in the reader.
      const resolved = await archiveCandidatesFor(itemId);
      if (!resolved) {
        return typedPdfError(
          415,
          "not_pdf",
          "No PDF file found in this archive.org item.",
        );
      }
      const candidates: string[] = resolved;

      let upstreamArchive: Response | null = null;
      let lastStatus = 0;
      let lastError = "";
      let refreshed = false;
      for (let i = 0; i < candidates.length; i++) {
        const target = candidates[i];
        try {
          const res = await fetchRemoteFile(
            target,
            req.headers.get("range"),
            ARCHIVE_UPSTREAM_TIMEOUT_MS,
          );
          if (res.status < 400) {
            rememberArchiveNode(itemId, target);
            upstreamArchive = res;
            break;
          }
          lastStatus = res.status;
          await res.body?.cancel().catch(() => {});
          console.warn("[pdf-proxy:archive]", itemId, target, "status", res.status);
        } catch (err) {
          lastError = (err as Error)?.message ?? String(err);
          console.warn("[pdf-proxy:archive]", itemId, target, "threw", lastError);
        }
        // A stale cached node → re-resolve from metadata exactly once and
        // continue through the freshly built candidate list.
        if (!refreshed && i === candidates.length - 1) {
          refreshed = true;
          archiveNodeCache.delete(itemId);
          dropSharedArchiveNode(itemId);
          const fresh = await archiveCandidatesFor(itemId, { skipCache: true });
          if (fresh) {
            for (const u of fresh) if (!candidates.includes(u)) candidates.push(u);
          }

        }
      }
      if (!upstreamArchive) {
        recordMetric({
          event: "archive_failure",
          tier: "archive",
          last_status: lastStatus || 502,
          last_content_type: lastError ? `error:${lastError}`.slice(0, 200) : null,
        });
        return typedPdfError(
          lastStatus === 404 ? 404 : 502,
          "archive_unavailable",
          "Archive.org is not responding right now. Please tap Retry in a moment.",
          { upstreamStatus: lastStatus || null },
        );
      }
      recordMetric({
        event: "archive_success",
        tier: "archive",
        last_status: upstreamArchive.status,
        last_content_type: upstreamArchive.headers.get("content-type"),
      });
      return await relayUpstream(upstreamArchive, req.method, req.headers.get("range"));

    }

    // kind=office → same allow-list + enrollment gate as `kind=url`, but the
    // payload is a DOCX/PPTX/XLSX (a ZIP container), so the `%PDF-` signature
    // check must NOT run. The client renders these with mammoth / exceljs /
    // pptx-preview; this branch exists only to defeat CORS and to keep the
    // same authorization rules as every other document route.
    if (kind === "office") {
      const target = input.searchParams.get("url") || "";
      // Same host allow-list as the PDF route — the office branch must not
      // widen the SSRF surface.
      if (!isAllowedPdfUrl(target)) {
        return new Response(JSON.stringify({ error: "URL not allowed" }), {
          status: 400,
          headers: headersWithCors({ "Content-Type": "application/json" }),
        });
      }
      if (!(await authorizeUrl(userId, target))) {
        return new Response(JSON.stringify({ error: "Not authorized for this file" }), {
          status: 403,
          headers: headersWithCors({ "Content-Type": "application/json" }),
        });
      }
      const upstreamOffice = await fetchRemoteFile(target, null);
      if (!upstreamOffice.ok || !upstreamOffice.body) {
        await upstreamOffice.body?.cancel().catch(() => {});
        return new Response(
          JSON.stringify({ error: `Upstream fetch failed: ${upstreamOffice.status}` }),
          { status: upstreamOffice.status || 502, headers: headersWithCors({ "Content-Type": "application/json" }) },
        );
      }
      if (isOversize(upstreamOffice)) {
        await upstreamOffice.body.cancel().catch(() => {});
        return new Response(JSON.stringify({ error: "File exceeds 80 MB limit" }), {
          status: 413,
          headers: headersWithCors({ "Content-Type": "application/json" }),
        });
      }
      return new Response(upstreamOffice.body, {
        status: 200,
        headers: headersWithCors({
          "Content-Type": upstreamOffice.headers.get("content-type") || "application/octet-stream",
          "Cache-Control": "private, max-age=600",
        }),
      });
    }

    // kind=url → generic CORS-safe proxy for allow-listed direct PDF CDNs
    // (jsDelivr, GitHub raw, etc). The web/native reader routes every
    // jsDelivr-hosted Class Notes PDF through here via remotePdfProxyUrl().
    if (kind === "url") {

      const target = input.searchParams.get("url") || "";
      if (!isAllowedPdfUrl(target)) {
        return new Response(JSON.stringify({ error: "URL not allowed" }), {
          status: 400,
          headers: headersWithCors({ "Content-Type": "application/json" }),
        });
      }
      // Enrollment/ownership gate — mirrors the Drive branch below so the
      // generic CDN proxy can't be used to bypass payment for paid PDFs.
      if (!(await authorizeUrl(userId, target))) {
        return new Response(JSON.stringify({ error: "Not authorized for this file" }), {
          status: 403,
          headers: headersWithCors({ "Content-Type": "application/json" }),
        });
      }
      const rangeHeader = req.headers.get("range");

      // Fast path for immutable, CORS-closed hosts (Vedantu lecture notes):
      // serve from the pdf-cache bucket via a signed CDN URL with native
      // Range support, and warm the cache on the first miss.
      if (req.method === "GET" && isCacheableRemote(target) && req.headers.get("cache-control") !== "no-cache") {
        const hit = await tryRemoteCacheRedirect(target);
        if (hit) return hit;
        warmRemoteCacheInBackground(target);
      }

      const upstreamUrl = await fetchRemoteFile(target, rangeHeader);

      // Skip the oversize check when a Range was requested — content-length
      // is the chunk size, not the full file. pdf.js relies on Range for
      // fast first-page paint of large PDFs.
      if (!rangeHeader && isOversize(upstreamUrl)) {
        return new Response(JSON.stringify({ error: "PDF exceeds 80 MB limit" }), {
          status: 413,
          headers: headersWithCors({ "Content-Type": "application/json" }),
        });
      }
      recordMetric({
        event: "url_success",
        tier: "url",
        last_status: upstreamUrl.status,
        last_content_type: upstreamUrl.headers.get("content-type"),
      });
      return await relayUpstream(upstreamUrl, req.method, rangeHeader);
    }

    if (kind !== "drive" || !DRIVE_ID_RE.test(id)) {
      return new Response(JSON.stringify({ error: "Valid Drive file id is required" }), {
        status: 400,
        headers: headersWithCors({ "Content-Type": "application/json" }),
      });
    }

    // Enrollment/ownership gate — mirrors the lesson_pdfs SELECT RLS so this
    // proxy can't be used to bypass payment for Drive-hosted lecture PDFs.
    if (!(await authorizeDrive(userId, id))) {
      return new Response(JSON.stringify({ error: "Not authorized for this file" }), {
        status: 403,
        headers: headersWithCors({ "Content-Type": "application/json" }),
      });
    }



    // Phase B: cache hit → 302 to signed Supabase Storage URL. The client
    // then streams from Supabase's CDN with real Range support so pdf.js
    // renders page 1 in seconds. Skip cache lookup on HEAD (client is
    // probing) and when caller explicitly asks for `no-cache`.
    if (req.method === "GET" && req.headers.get("cache-control") !== "no-cache") {
      const hit = await tryCacheRedirect(id);
      if (hit) return hit;
    }

    // Cache miss — fetch from Drive and tee the body: one stream to the
    // browser, one to the storage upload (fire-and-forget).
    const upstream = await fetchDriveFile(id);
    if (!upstream.ok || !upstream.body) {
      const downloadDisabled = upstream.statusText === DRIVE_DOWNLOAD_DISABLED;
      const privateLike = upstream.status === 403 || upstream.status === 404 || upstream.status === 415;
      const type = downloadDisabled ? "drive_download_disabled" : privateLike ? "drive_private" : "drive_fetch_failed";
      return new Response(JSON.stringify({
        error: downloadDisabled
          ? "The owner has disabled downloading for this Drive file — it can only be read on Drive."
          : privateLike
            ? "This Drive file is private — ask the uploader to enable link sharing."
            : `Drive fetch failed: ${upstream.status}`,
        type,
        viewUrl: `https://drive.google.com/file/d/${id}/view`,
        fallback: false,
      }), {
        // `drive_download_disabled` is an EXPECTED, user-facing condition (the
        // owner turned off downloads), not a proxy failure. Answering 403 made
        // the platform log it as an edge-function RUNTIME_ERROR on every open.
        // Return 200 with the typed body + header instead; the reader keys off
        // `X-Pdf-Error-Code` and renders the read-only Drive preview.
        status: downloadDisabled ? 200 : (upstream.status || 502),
        headers: headersWithCors({ "Content-Type": "application/json", "X-Pdf-Error-Code": type }),
      });
    }


    const checkedDrive = await validatePdfResponse(upstream, null);
    if (!checkedDrive.ok) return checkedDrive;
    const safeUpstream = checkedDrive;
    const upstreamLen = safeUpstream.headers.get("content-length");
    const upstreamType = safeUpstream.headers.get("content-type") || "application/pdf";
    const outHeaders: Record<string, string> = {
      "Content-Type": upstreamType,
      "Cache-Control": "public, max-age=86400, s-maxage=86400, immutable, no-transform",
      "CDN-Cache-Control": "public, max-age=86400, immutable, no-transform",
      "Cache-Tag": `drive:${id}`,
      "Accept-Ranges": "none",
      "Content-Encoding": "identity",
      "X-Pdf-Cache": "miss",
    };
    const upstreamEnc = (safeUpstream.headers.get("content-encoding") || "").toLowerCase();
    if (upstreamLen && (upstreamEnc === "" || upstreamEnc === "identity")) {
      outHeaders["Content-Length"] = upstreamLen;
    }
    for (const h of ["etag", "last-modified"]) {
      const v = safeUpstream.headers.get(h);
      if (v) outHeaders[h] = v;
    }

    if (req.method === "HEAD") {
      return new Response(null, { status: safeUpstream.status, headers: headersWithCors(outHeaders) });
    }

    // Tee: one branch streams to the client, the other buffers for the
    // pdf-cache upload. Client latency is unaffected — the upload runs
    // concurrently and any failure is logged, never surfaced.
    if (!safeUpstream.body) {
      return typedPdfError(502, "empty_upstream", "The upstream PDF returned an empty body.");
    }
    const [toClient, toCache] = safeUpstream.body.tee();
    cacheDriveBodyInBackground(id, toCache, upstreamType);

    return new Response(toClient, {
      status: safeUpstream.status,
      headers: headersWithCors(outHeaders),
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = /timeout/i.test(message) || (error as { name?: string })?.name === "AbortError";
    console.error("pdf-proxy error", message);
    return new Response(JSON.stringify({ error: isTimeout ? "Upstream PDF timed out" : "PDF proxy failed", code: isTimeout ? "upstream_timeout" : "proxy_failed" }), {
      status: isTimeout ? 504 : 500,
      headers: headersWithCors({ "Content-Type": "application/json" }),
    });
  }
});

// Allow-list of trusted direct PDF CDNs proxied via kind=url. Keep this tight
// so the function can't be abused as an open proxy.
const ALLOWED_HOSTS = [
  /(^|\.)cdn\.jsdelivr\.net$/i,
  /(^|\.)raw\.githubusercontent\.com$/i,
  /(^|\.)blob\.core\.windows\.net$/i,
  /(^|\.)github-storages-cdn\.vercel\.app$/i,
  /(^|\.)storage-safarenglishka-recording\.vercel\.app$/i,
  /(^|\.)storage-naveenbharat-recording\.vercel\.app$/i,
  // Google serves the actual export bytes from a googleusercontent redirect
  // hop; without this the SSRF re-validation turns a valid doc into a 502.
  /(^|\.)googleusercontent\.com$/i,
  // archive.org item pages + their `ia*.us.archive.org` download nodes.
  /(^|\.)archive\.org$/i,
  // Vedantu lecture-notes object storage (GCS-backed, range-streamable,
  // immutable object URLs) — no CORS headers upstream, so the bytes must be
  // relayed. Exact host only; the rest of vedantu.com stays untrusted.
  /^prod-recordings\.vedantu\.com$/i,
];

/**
 * Quality tier of an archive.org PDF derivative (lower = better to serve).
 * 0 = `*_text.pdf` (full-quality page images + OCR layer, well compressed)
 * 1 = any other colour/greyscale PDF
 * 2 = bitonal `*_bw.pdf` (washed-out scans — last resort only)
 */
function archivePdfRank(name: string): number {
  if (/_text\.pdf$/i.test(name)) return 0;
  if (/_bw\.pdf$/i.test(name)) return 2;
  return 1;
}


/**
 * Resolve an archive.org item id to direct CDN node URLs for its PDF file.
 *
 * The metadata payload already carries the datanode hostnames (`server`, `d1`,
 * `d2`, `workable_servers`) plus the item `dir`, so we can build the final
 * `iaXXXX.us.archive.org/<dir>/<file>` URL WITHOUT walking the
 * `archive.org/download/...` redirector — that redirector is frequently 503
 * (observed Aug 2026) which is what turned every Archive note into a hard
 * error / "Reconnecting" stall in the reader.
 *
 * Returns the candidate node URLs in preference order, plus the classic
 * download URL as a last-resort fallback. `null` = item has no PDF file.
 */
async function resolveArchiveCandidates(itemId: string): Promise<string[] | null> {
  // Hard 8s BUDGET for the whole metadata resolve (was 2 x 15s = ~30s).
  // An invalid / non-existent item used to keep the reader on "Reconnecting"
  // for half a minute before it could show anything actionable. Now: at most
  // two attempts inside one 8s deadline, then we fail fast with a typed error
  // the UI turns into a real message + Retry CTA.
  const ARCHIVE_META_BUDGET_MS = 8_000;
  const deadline = Date.now() + ARCHIVE_META_BUDGET_MS;
  type Meta = {
    files?: { name?: string; format?: string; size?: string }[];
    server?: string;
    d1?: string;
    d2?: string;
    workable_servers?: string[];
    dir?: string;
  };
  let meta: Meta | null = null;
  for (let attempt = 0; attempt < 2 && !meta; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 500) break;
    // First attempt gets the bulk of the budget, the retry whatever is left.
    const attemptMs = attempt === 0 ? Math.min(5_000, remaining) : remaining;
    try {
      const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(itemId)}`, {
        signal: timeoutSignal(attemptMs),
        headers: { Accept: "application/json" },
      });
      if (!res.ok) { await res.body?.cancel().catch(() => {}); continue; }
      meta = await res.json();
    } catch { /* retry while budget remains */ }
  }
  if (!meta) return null;
  const files = (meta.files ?? []).filter((f) => typeof f.name === "string" && /\.pdf$/i.test(f.name!));
  if (files.length === 0) return null;
  // File choice = the single biggest factor in whether an Archive item opens
  // on a phone AND in how readable the pages look.
  //
  // "Always take the smallest PDF" was too blunt: for scanned books the
  // smallest derivative is usually the bitonal `*_bw.pdf`, which is exactly
  // the washed-out low-quality page users reported. The raw "Image Container
  // PDF" at the other extreme can exceed 1.4 GB and is not linearized, so
  // pdf.js needs minutes of range requests before the first page paints.
  //
  // Ranking (quality first, then size):
  //   1. `*_text.pdf` — derived, SAME page images + OCR layer, ~4-5x smaller.
  //   2. any other colour/greyscale PDF, smallest first, sub-400MB preferred.
  //   3. bitonal `*_bw.pdf` only as a last resort.
  const pool = [...files].sort((a, b) => {
    const ra = archivePdfRank(a.name!);
    const rb = archivePdfRank(b.name!);
    if (ra !== rb) return ra - rb;
    const sa = Number(a.size || 0) || Number.MAX_SAFE_INTEGER;
    const sb = Number(b.size || 0) || Number.MAX_SAFE_INTEGER;
    const huge = 400 * 1024 * 1024;
    if ((sa > huge) !== (sb > huge)) return sa > huge ? 1 : -1;
    return sa - sb;
  });
  const name = pool[0].name!;

  const encodedName = name.split("/").map(encodeURIComponent).join("/");
  const candidates: string[] = [];
  const dir = typeof meta.dir === "string" ? meta.dir : "";
  if (dir) {
    const servers = [meta.server, meta.d1, meta.d2, ...(meta.workable_servers ?? [])]
      .filter((s): s is string => typeof s === "string" && /^[a-z0-9.-]+\.archive\.org$/i.test(s));
    for (const host of servers) {
      const url = `https://${host}${dir.startsWith("/") ? dir : `/${dir}`}/${encodedName}`;
      if (!candidates.includes(url) && isAllowedPdfUrl(url)) candidates.push(url);
    }
  }
  // Last resort: the classic redirector (slow + often 503, hence last).
  candidates.push(`https://archive.org/download/${encodeURIComponent(itemId)}/${encodedName}`);
  return candidates;
}


/**
 * Archive.org fast path (archive-only, no effect on any other source).
 *
 * pdf.js issues dozens of Range requests per document. Without a cache each
 * one re-ran the `/metadata/<id>` lookup AND re-walked the
 * `archive.org/download/...` → `iaXXXX.us.archive.org` redirect chain, which
 * is what made large Archive items crawl. We resolve the item once and cache
 * the final CDN node URL per isolate for 10 minutes.
 */
const ARCHIVE_NODE_TTL_MS = 10 * 60 * 1000;
const archiveNodeCache = new Map<string, { nodeUrl: string; expiresAt: number }>();

function getCachedArchiveNode(itemId: string): string | null {
  const hit = archiveNodeCache.get(itemId);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    archiveNodeCache.delete(itemId);
    return null;
  }
  return hit.nodeUrl;
}

function setCachedArchiveNode(itemId: string, nodeUrl: string): void {
  archiveNodeCache.set(itemId, { nodeUrl, expiresAt: Date.now() + ARCHIVE_NODE_TTL_MS });
}

/**
 * Cached resolve: item id → ordered list of direct CDN node URLs for its PDF.
 * Two layers: per-isolate map (10 min) in front of the shared Storage marker
 * (6 h) so a cold isolate skips the `/metadata` lookup entirely.
 *
 * `skipCache` forces a fresh metadata resolve — used when a cached node URL
 * turns out to be stale (403/404/410/5xx from the datanode).
 */
async function archiveCandidatesFor(
  itemId: string,
  opts: { skipCache?: boolean } = {},
): Promise<string[] | null> {
  if (!opts.skipCache) {
    const cached = getCachedArchiveNode(itemId);
    if (cached) return [cached];
    const shared = await readSharedArchiveNode(itemId);
    if (shared) {
      setCachedArchiveNode(itemId, shared);
      return [shared];
    }
  }
  const candidates = await resolveArchiveCandidates(itemId);
  return candidates && candidates.length > 0 ? candidates : null;
}

/** Remember the datanode URL that actually served bytes. */
function rememberArchiveNode(itemId: string, nodeUrl: string): void {
  // Never cache the slow/flaky redirector — only real datanode URLs.
  if (/(^|\/\/)archive\.org\/download\//i.test(nodeUrl)) return;
  if (getCachedArchiveNode(itemId) === nodeUrl) return;
  setCachedArchiveNode(itemId, nodeUrl);
  writeSharedArchiveNode(itemId, nodeUrl);
}




// Google Docs / Sheets / Slides are allowed ONLY on their PDF export paths.
// This keeps the function from becoming a general docs.google.com proxy while
// letting admin pre-flight + the reader stream a published doc as PDF bytes.
const GOOGLE_DOCS_HOST = /^docs\.google\.com$/i;
const GOOGLE_EXPORT_PATH =
  /^\/(document|spreadsheets|presentation)\/d\/[A-Za-z0-9_-]+\/export\/?$/;

// Admin-managed allowlist (public.trusted_hosts, category = 'pdf'). Loaded
// with the service-role client and cached in memory so the per-Range-request
// hot path never touches Postgres. The static ALLOWED_HOSTS list above stays
// as a fail-safe baseline if the DB read fails.
const DYNAMIC_HOSTS_TTL_MS = 60_000;
let dynamicHosts = new Set<string>();
let dynamicHostsLoadedAt = 0;
let dynamicHostsInFlight: Promise<void> | null = null;

export function _setDynamicPdfHostsForTest(hosts: string[]): void {
  dynamicHosts = new Set(hosts.map((h) => h.trim().toLowerCase()).filter(Boolean));
  dynamicHostsLoadedAt = Date.now();
}

/** Refresh the admin allowlist at most once per TTL. Never throws. */
export async function refreshDynamicPdfHosts(): Promise<void> {
  if (!adminClient) return;
  if (Date.now() - dynamicHostsLoadedAt < DYNAMIC_HOSTS_TTL_MS) return;
  if (dynamicHostsInFlight) return dynamicHostsInFlight;
  dynamicHostsInFlight = (async () => {
    try {
      const { data, error } = await adminClient
        .from("trusted_hosts")
        .select("host")
        .in("category", ["pdf", "frame"])
        .eq("enabled", true);
      if (error) throw error;
      dynamicHosts = new Set(
        (data ?? [])
          .map((r) => String((r as { host?: string }).host ?? "").trim().toLowerCase())
          .filter(Boolean),
      );
      dynamicHostsLoadedAt = Date.now();
    } catch (err) {
      // Keep the previous snapshot; never fail a read because the table is
      // unreachable. Static baseline still applies.
      console.error("pdf-proxy: trusted_hosts load failed", (err as Error)?.message);
      dynamicHostsLoadedAt = Date.now() - DYNAMIC_HOSTS_TTL_MS / 2;
    } finally {
      dynamicHostsInFlight = null;
    }
  })();
  return dynamicHostsInFlight;
}

/** host matches an admin entry exactly, or is a subdomain of one. */
function matchesDynamicHost(host: string): boolean {
  if (dynamicHosts.size === 0) return false;
  const h = host.toLowerCase();
  if (dynamicHosts.has(h)) return true;
  for (const entry of dynamicHosts) {
    if (h.endsWith(`.${entry}`)) return true;
  }
  return false;
}

export function isAllowedPdfUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    // SSRF guard: https only, no credentials, no non-default ports, no
    // IP-literal hosts (defeats DNS-rebinding / localhost / 169.254.169.254
    // metadata abuse), allow-listed CDN hostnames only.
    if (u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    if (u.port && u.port !== "443") return false;
    const host = u.hostname;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false; // IPv4 literal
    if (host.includes(":")) return false;                 // IPv6 literal
    if (/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(host)) return false;
    if (GOOGLE_DOCS_HOST.test(host)) return GOOGLE_EXPORT_PATH.test(u.pathname);
    if (ALLOWED_HOSTS.some((re) => re.test(host))) return true;
    return matchesDynamicHost(host);
  } catch {
    return false;
  }
}


// Manually follow up to N redirects, re-validating each hop against the
// allow-list. `redirect: "follow"` would let a compromised or misconfigured
// CDN 302 the proxy into `http://169.254.169.254/…` or another private host;
// re-validating at every hop closes that SSRF gap.
const MAX_REDIRECTS = 3;

async function fetchRemoteFile(
  url: string,
  range: string | null,
  timeoutMs = UPSTREAM_TIMEOUT_MS,
): Promise<Response> {
  const headers = new Headers({
    Accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.1",
    // Identity encoding keeps upstream `content-length` byte-exact with the
    // body we relay, so we can safely forward it (real % progress in the
    // reader + pdf.js range streaming).
    "Accept-Encoding": "identity",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });
  if (range) headers.set("Range", range);

  let currentUrl = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedPdfUrl(currentUrl)) {
      // Synthesize a 502 so the caller sees an upstream failure instead of
      // us silently opening a hole to a private host.
      return new Response(
        JSON.stringify({ error: "Upstream redirected to a disallowed host" }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
    const res = await fetch(currentUrl, {
      headers,
      redirect: "manual",
      signal: timeoutSignal(timeoutMs),
    });
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get("location");
    // Drain redirect body to avoid Deno resource leak warnings.
    await res.body?.cancel().catch(() => {});
    if (!loc) return res;
    try {
      currentUrl = new URL(loc, currentUrl).toString();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid redirect target" }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
  }
  return new Response(
    JSON.stringify({ error: "Too many redirects" }),
    { status: 502, headers: { "Content-Type": "application/json" } },
  );
}

function typedPdfError(status: number, code: string, error: string, details: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ error, code, ...details }), {
    status,
    headers: headersWithCors({ "Content-Type": "application/json" }),
  });
}

/**
 * Validate the first bytes without buffering the document. We only sniff full
 * responses and ranges beginning at byte zero; later ranges do not contain the
 * PDF header. The consumed prefix is re-enqueued before the untouched stream.
 */
export function rangeContainsPdfSignature(requestedRange: string | null): boolean {
  if (!requestedRange) return true;
  const match = requestedRange.trim().match(/^bytes=0-(\d+)$/i);
  // Only sniff a byte-zero range when it contains all five `%PDF-` bytes.
  // A size probe such as bytes=0-0 is valid HTTP and must not become a false
  // `415 not_pdf` merely because the caller intentionally requested one byte.
  return !!match && Number(match[1]) >= 4;
}

async function validatePdfResponse(upstream: Response, requestedRange: string | null): Promise<Response> {
  const contentType = upstream.headers.get("content-type") || "";
  if (/text\/html|application\/xhtml|application\/json/i.test(contentType)) {
    await upstream.body?.cancel().catch(() => {});
    return typedPdfError(415, "not_pdf", "The link returned a web page or JSON response instead of a PDF file.", { contentType });
  }
  const shouldSniff = rangeContainsPdfSignature(requestedRange);
  if (!shouldSniff || !upstream.body) return upstream;

  const reader = upstream.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < 5) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) { chunks.push(value); total += value.byteLength; }
  }
  const prefix = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { prefix.set(chunk, offset); offset += chunk.byteLength; }
  const signature = new TextDecoder().decode(prefix.subarray(0, 5));
  if (!signature.startsWith("%PDF-")) {
    await reader.cancel().catch(() => {});
    return typedPdfError(415, "not_pdf", "The upstream response is not a valid PDF file.", {
      contentType,
      signature: signature.replace(/[^\x20-\x7E]/g, "?"),
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(prefix);
    },
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) controller.close();
        else if (value) controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  return new Response(stream, { status: upstream.status, statusText: upstream.statusText, headers: upstream.headers });
}

async function relayUpstream(upstream: Response, method: string, range: string | null): Promise<Response> {
  if (!upstream.ok || !upstream.body) {
    return new Response(JSON.stringify({ error: `Upstream fetch failed: ${upstream.status}` }), {
      status: upstream.status || 502,
      headers: headersWithCors({ "Content-Type": "application/json" }),
    });
  }
  const checked = await validatePdfResponse(upstream, range);
  if (!checked.ok) return checked;
  upstream = checked;

  const outHeaders: Record<string, string> = {
    "Content-Type": upstream.headers.get("content-type") || "application/pdf",
    "Cache-Control": "public, max-age=86400, s-maxage=86400, immutable",
    "CDN-Cache-Control": "public, max-age=86400, immutable",
    "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
  };
  for (const h of ["content-range", "etag", "last-modified"]) {
    const v = upstream.headers.get(h);
    if (v) outHeaders[h] = v;
  }
  // Total size of the WHOLE file (not the current chunk). Derived from
  // `content-range: bytes a-b/TOTAL` when a Range was served, else from
  // `content-length` on a full 200 response. The reader uses this to show a
  // real percentage even when the browser can't see a Content-Length.
  const contentRange = upstream.headers.get("content-range") || "";
  const upstreamLen = upstream.headers.get("content-length");
  const upstreamEnc = (upstream.headers.get("content-encoding") || "").toLowerCase();
  const identity = upstreamEnc === "" || upstreamEnc === "identity";
  const rangeTotal = contentRange.match(/\/(\d+)\s*$/)?.[1];
  const total = rangeTotal || (upstream.status === 200 && identity ? upstreamLen : null);
  if (total && Number(total) > 0) outHeaders["X-Pdf-Total-Bytes"] = total;
  // Forwarding Content-Length is safe only when the upstream body is identity
  // encoded — otherwise the declared size differs from the relayed bytes and
  // pdf.js aborts near the tail. With it present, pdf.js can switch to range
  // streaming (critical for large archive.org scans).
  if (upstreamLen && identity) outHeaders["Content-Length"] = upstreamLen;
  return new Response(method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers: headersWithCors(outHeaders),
  });
}


/** statusText marker used to signal "shared, but download is disabled". */
const DRIVE_DOWNLOAD_DISABLED = "Drive download disabled";

/** True when a Drive HTML body is the "download not allowed" interstitial. */
function isDownloadDisabledHtml(html: string): boolean {
  return /hasn.{0,3}t given you permission to download|Only the owner and editors can download|download this file/i.test(
    html,
  );
}


/**
 * Fallback chain for Google Drive PDFs. Each tier is logged with
 * `[pdf-proxy:drive]` so we can see in Supabase logs which path actually
 * served the file (telemetry).
 *
 *   tier 1: drive.usercontent.google.com/download?confirm=t
 *   tier 2: drive.google.com/uc — parse the interstitial <form> + cookie
 *   tier 3: drive.google.com/uc&confirm=<legacy-token>
 *   tier 4: docs.google.com/uc?export=download  (older mirror)
 */
async function fetchDriveFile(id: string): Promise<Response> {
  const baseHeaders = new Headers({
    Accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.1",
    // Force identity so `Content-Length` we forward matches the actual byte
    // stream. Without this, Drive may respond with gzip/br and the length
    // we forward is the compressed size — pdf.js then aborts near the tail
    // with "Content-Length header ... exceeds response Body".
    "Accept-Encoding": "identity",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });

  const log = (tier: string, info: Record<string, unknown>) =>
    console.info("[pdf-proxy:drive]", tier, { id, ...info });

  const driveFetch = (url: string, headers: Headers) =>
    fetch(url, { headers, redirect: "follow", signal: timeoutSignal(DRIVE_UPSTREAM_TIMEOUT_MS) });

  // tier 1
  // acknowledgeAbuse=true bypasses the "can't scan for viruses" interstitial
  // that large Drive PDFs (>25MB) always hit — this is the #1 cause of the
  // "blank/could not load" reports from students opening lecture Drive links.
  const directUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&authuser=0&confirm=t&acknowledgeAbuse=true`;
  let res = await driveFetch(directUrl, baseHeaders);
  let ct = res.headers.get("content-type") || "";
  log("tier1-direct", { status: res.status, ct });
  if (res.ok && !/text\/html/i.test(ct)) {
    recordMetric({ event: "drive_success", drive_id: id, tier: "tier1-direct", last_status: res.status, last_content_type: ct });
    return res;
  }

  // The file may be shared publicly but with "Viewers and commenters can
  // download / print / copy" turned OFF. Drive then answers every download
  // endpoint with an HTML interstitial ("the owner hasn't given you
  // permission to download this file") — HTTP 200, so nothing downstream can
  // tell it apart from a private file. Detect it here and fail with a typed
  // status so the reader can say what is actually wrong.
  if (/text\/html/i.test(ct)) {
    const interstitial = await res.clone().text().catch(() => "");
    if (isDownloadDisabledHtml(interstitial)) {
      log("download-disabled", { status: res.status });
      recordMetric({ event: "drive_download_disabled", drive_id: id, tier: "tier1-direct", last_status: 403, last_content_type: ct });
      return new Response(null, { status: 403, statusText: DRIVE_DOWNLOAD_DISABLED });
    }
  }


  // tier 2
  const ucUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}&acknowledgeAbuse=true`;
  res = await driveFetch(ucUrl, baseHeaders);
  ct = res.headers.get("content-type") || "";
  log("tier2-uc", { status: res.status, ct });
  if (!/text\/html/i.test(ct)) {
    recordMetric({ event: "drive_success", drive_id: id, tier: "tier2-uc", last_status: res.status, last_content_type: ct });
    return res;
  }

  const html = await res.text();
  const cookie = res.headers.get("set-cookie")?.split(";")[0];

  const formAction = html.match(/<form[^>]+action="([^"]+download[^"]*)"/i)?.[1];
  const hiddenInputs: Record<string, string> = {};
  for (const m of html.matchAll(/<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"/gi)) {
    hiddenInputs[m[1]] = m[2].replace(/&amp;/g, "&");
  }

  if (formAction && Object.keys(hiddenInputs).length) {
    const qs = new URLSearchParams(hiddenInputs).toString();
    const confirmedHeaders = new Headers(baseHeaders);
    if (cookie) confirmedHeaders.set("Cookie", cookie);
    const sep = formAction.includes("?") ? "&" : "?";
    const followUrl = `${formAction.replace(/&amp;/g, "&")}${sep}${qs}&acknowledgeAbuse=true`;
    res = await driveFetch(followUrl, confirmedHeaders);
    ct = res.headers.get("content-type") || "";
    log("tier2-form", { status: res.status, ct });
    if (res.ok && !/text\/html/i.test(ct)) {
      recordMetric({ event: "drive_success", drive_id: id, tier: "tier2-form", last_status: res.status, last_content_type: ct });
      return res;
    }
  }

  // tier 3 — legacy confirm token
  const token = html.match(/[?&]confirm=([0-9A-Za-z_\-]+)/)?.[1];
  if (token) {
    const confirmedHeaders = new Headers(baseHeaders);
    if (cookie) confirmedHeaders.set("Cookie", cookie);
    res = await driveFetch(`${ucUrl}&confirm=${encodeURIComponent(token)}`, confirmedHeaders);
    ct = res.headers.get("content-type") || "";
    log("tier3-token", { status: res.status, ct });
    if (res.ok && !/text\/html/i.test(ct)) {
      recordMetric({ event: "drive_success", drive_id: id, tier: "tier3-token", last_status: res.status, last_content_type: ct });
      return res;
    }
  }

  // tier 4 — docs.google.com mirror (older Drive ids still resolve here)
  const docsUrl = `https://docs.google.com/uc?export=download&id=${encodeURIComponent(id)}&acknowledgeAbuse=true`;
  res = await driveFetch(docsUrl, baseHeaders);
  ct = res.headers.get("content-type") || "";
  log("tier4-docs", { status: res.status, ct });
  if (res.ok && !/text\/html/i.test(ct)) {
    recordMetric({ event: "drive_success", drive_id: id, tier: "tier4-docs", last_status: res.status, last_content_type: ct });
    return res;
  }

  log("exhausted", { lastStatus: res.status });
  recordMetric({ event: "drive_exhausted", drive_id: id, tier: "exhausted", last_status: res.status, last_content_type: ct });
  return new Response(null, { status: 415, statusText: "Drive did not return a PDF" });
}
// redeploy touch 2026-08-01
