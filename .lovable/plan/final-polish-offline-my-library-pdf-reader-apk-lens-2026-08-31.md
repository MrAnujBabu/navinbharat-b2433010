# Final polish: offline / My Library PDF reader (APK lens)

One consolidated audit-and-fix pass over the reader, using the requested lenses, plus a fresh live re-verification with the test account. Only defects found get code changes — no new features.

## 1. Live re-verification (evidence, not claims)

Sign in headlessly on the running preview (credentials used once inside the script, never printed or screenshotted) and re-walk the flow end to end:

- `/login` → lands on `/downloads`.
- Save a PDF into My Library → confirm real bytes are stored (starts with `%PDF`, size > 0), not a bare URL.
- Open it → reader renders locally; tap once hides the header (no leftover strip), tap again shows it; count toggles to prove one tap = one toggle.
- History/hardware back closes the reader instead of leaving the page.
- Collect console + network errors for the whole run.

Deliverable: pass/fail table with screenshots appended to `docs/observer/2026-08-31-sentry-triage.md`.

## 2. Audit lenses and what each one inspects

- **app-crash-shield** — error boundaries around the reader/library routes, OOM guards on large PDFs, safe failure when a saved file is missing or corrupt.
- **console-error-triage** — every console error/warning captured in step 1, triaged and fixed or explained.
- **capacitor-back-button** — nested overlay sentinels (reader inside folder inside Downloads) pop inner-first with no double-close.
- **mobile-view-expert / soft-touch** — safe-area insets, 44px tap targets, header transition, one-hand reachability on small screens; tone of the error copy in the save-offline path.
- **asset-optimization** — reader-route bundle weight and the pdf.js/worker payload on cold open.
- **perf-exam-ready** — cold-open budget for a saved PDF, no per-tap re-rasterisation, memory ceiling on save.
- **senior-architect-audit** — SEC/DATA/PERF/RELY review of the changed files (`DocReaderShell`, `fetchDocumentBlob`, `linkOfflineSave`, `pdf-proxy` allowlist).
- **red-team-security-audit** — SSRF surface of the dynamic allowlist, token leakage (the access token must reach only `pdf-proxy`, never a third-party host), and whether the admin PDF tab can be reached by a non-admin.
- **sentry-triage** — re-pull unresolved issues and mark which ones the fixes close.
- **capacitor-video-player-master** — expected N/A here (reader scope); will be stated explicitly rather than skipped.
- **supabase-architect-auditor** — the project is not linked to Lovable, so live linter/queries are unavailable. This lens will be a static review of `trusted_hosts` RLS + GRANTs and the `pdf-proxy` service-role read, delivered as review notes on `docs/db/2026-08-31-trusted-hosts-pdf-category.sql` — no migration is run.

## 3. Fixes

Anything HIGH/CRITICAL found gets fixed in the same pass, with a test where the behaviour is testable. MEDIUM/LOW items are listed in the report and added to `roadmap.md`.

## 4. Report

Single report in `docs/observer/` with rating, findings by severity with evidence, wins, and a fix plan. `roadmap.md` updated.

## Still requires you (unchanged, cannot be done from this sandbox)

- Run `docs/db/2026-08-31-trusted-hosts-pdf-category.sql` and redeploy `pdf-proxy` — until then the deployed proxy still answers `400 URL not allowed` for the NCERT / crwilladmin links.
- Attach the three PDFs to Amar Batch through the live admin UI.
- `npx cap sync android && ./gradlew assembleDebug` for the APK device test — no Android SDK or device here.

Also: rotate that account password once testing is finished, since it was pasted in chat.
