# Roadmap

- [x] Fix offline/My Library PDF reader header: tap + fullscreen must hide the top bar, no leftover white strip
- [x] Audit follow-ups: single-source surface tap (no double toggle), reader-owned back sentinel, idle-debounced relayout
- [ ] Connect the user's existing "Naveen Bharat" Supabase project (needs user action in Lovable UI)
- [ ] Optional: add CI pipelines (`.github/workflows`, `maestro/`, `e2e/`) — none exist in this project, so device/E2E verification can't run here
- [x] Admin "PDF Links" tab (chip filters, bulk paste, per-link probe) + pdf-proxy dynamic allowlist from `trusted_hosts`
- [x] `/login` now lands on `/downloads`
- [x] Sentry verified (org naveen-bharat, 7 unresolved) → `docs/observer/2026-08-31-sentry-triage.md`
- [ ] Run `docs/db/2026-08-31-trusted-hosts-pdf-category.sql` + redeploy `pdf-proxy` on the Naveen Bharat project
- [ ] Attach the 3 approved PDFs to Amar Batch (needs admin upload UI on the live app)
- [ ] Sentry noise PR: drop transient network + empty `{}` events; reject non-`%PDF` bytes before offline save
- [x] Live signed-in verification of the offline reader (header toggle, back contract, zero console errors) → `docs/observer/2026-08-31-final-polish-audit.md`
- [x] Crash shield: wrap every `DocReaderShell` mount (study materials, lesson attachments) in `ReaderErrorBoundary`
- [x] Deep PDF delivery perf pass + ELO scoring (962/1000) → `docs/perf/PDF-PERF-2026-09-01.md`
- [x] Fix unbounded canvas retention on long PDFs (`shouldReleaseDistantPages` page-count rule + test)
- [ ] Re-measure reader memory on a 300-page scan on a real device after the APK build

- [x] Clear preview typecheck errors (Error `cause` needs ES2022.Error lib — added to tsconfig.app.json)
- [ ] Fix preview typecheck errors introduced during the lint/typing pass (ContentDrillDown, LibraryManager, PaymentsSection, useLessons)
- [x] Typecheck errors from the typing pass fixed (build green, 510 tests pass)
- [ ] Remaining 279 lint warnings (mostly `any` in src/pages/* + edge functions) — continue typing pass
