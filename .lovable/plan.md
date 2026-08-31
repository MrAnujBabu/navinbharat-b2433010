# Admin PDF Link Allowlist + Login → Downloads

## What you get

1. A new **PDF Links** chip tab in the admin Trusted Hosts screen where you paste full PDF URLs (one per line), and the app allows them — no code edit needed.
2. `pdf-proxy` starts honouring that admin list, so `crwilladmin.com` and `ncert.nic.in` PDFs actually stream instead of returning "URL not allowed".
3. A bulk "Test open" action that pre-flights each pasted link and shows exactly what breaks (403, no Range support, HTML instead of PDF, CORS).
4. `/login` sends signed-in users to `/downloads` so you can go straight into the reader on your phone.

## Current state (verified)

- `supabase/functions/pdf-proxy/index.ts:871` has a **hardcoded** `ALLOWED_HOSTS` regex list. Neither `cwmediabkt99.crwilladmin.com` nor `ncert.nic.in` is in it, so `isAllowedPdfUrl()` returns false and the function answers `{"error":"URL not allowed"}` (lines 676, 718). That is the reason those three links fail today.
- `public.trusted_hosts` already exists (categories: frame/image/media/website/script/connect) and is managed by `src/pages/AdminTrustedHosts.tsx` + `src/hooks/useTrustedHosts.ts`. It is currently only a client-side/CSP hint — the edge function never reads it.
- `src/pages/Login.tsx:30` redirects to `location.state.from || "/dashboard"`.

## Work

### 1. Admin chip tab (`AdminTrustedHosts.tsx`)
- Add chip-style filter row (pill chips, not the current dropdown) with a new **PDF Links** category alongside the existing ones.
- Add a bulk paste textarea: paste full URLs, we extract + normalize hostnames, dedupe against existing rows, and insert them with `category = 'pdf'`.
- Each row shows host, label, enabled switch, and a **Test** button.
- Seed the three links you gave (`cwmediabkt99.crwilladmin.com`, `ncert.nic.in`) via the UI on first use.

### 2. Database
- Migration: extend the `trusted_hosts` category check/enum with `'pdf'`; keep existing RLS (admin-only read/write) and add a `service_role` read path so the edge function can load the list. GRANTs included.

### 3. `pdf-proxy` reads the admin list
- Keep the hardcoded list as a static baseline (fail-safe if the DB read fails).
- Add a 60s in-memory cache of `trusted_hosts where category='pdf' and enabled` loaded with the service-role client; `isAllowedPdfUrl()` becomes async and checks static ∪ dynamic.
- Keep every SSRF guard as-is (https only, no creds, no ports, no IP literals, no private ranges) and apply the same check to redirect hops.

### 4. Diagnose the three links
- With the allowlist fixed, run a HEAD/Range pre-flight on each URL and report per link: status, `content-type`, `accept-ranges`, size. Expected findings to confirm, not assume: NCERT is plain static PDF (should just work); `crwilladmin.com` is a signed-path CDN that may reject non-browser referers or omit Range — if so, the proxy's byte-relay path handles it and we note the cost.
- Add the working links to the Amar batch: I need you to confirm where they should land (see Open questions) since your Supabase project isn't linked to Lovable yet, so I can't write rows directly — I'll drive it through the existing admin upload UI.

### 5. `/login` → `/downloads`
- Default destination becomes `/downloads` (still honours `location.state.from` deep links).

### 6. Audits (senior-architect-audit, perf-exam-ready, sentry-triage)
- Architecture/design review of the new tab + proxy change (SEC/DATA/PERF/VIS lenses), reported inline.
- Perf: confirm the DB lookup adds no per-Range-request latency (cache), and that reader cold-open budget is unchanged.
- Sentry: verify the connection and pull the last 14 days of issues, then produce `docs/observer/<date>-sentry-triage.md` with a priority-ordered fix plan.

## What I cannot do from here

- **Install the APK on your phone.** This sandbox has no Android SDK/device. I can build the web bundle and verify the offline save/open flow in a browser and via the existing reader tests; the APK step needs `npx cap sync android && ./gradlew assembleDebug` on your machine (or your CI).
- **Write to your Supabase directly.** "Naveen Bharat" still isn't linked to Lovable, so migrations and the edge-function redeploy have to be applied by you (I'll hand you the exact SQL + function diff), or link it via + → Integrations → Supabase and I'll run them.

## Open questions

1. In "Amar Batch", should these PDFs be added as lesson notes (`lesson_pdfs`), course materials, or library items?
2. Should non-admin users ever be able to open an arbitrary allowed-host PDF, or only ones an admin attached to a lesson/batch (current enrollment gate)?
