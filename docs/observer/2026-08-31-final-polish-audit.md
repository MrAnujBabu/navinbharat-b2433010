# Final Polish Audit — Offline / My Library PDF Reader (APK lens) — 2026-08-31

**Rating: 4/5** — the reader flow is verified working end to end; one real crash-scope gap was
found and fixed, remaining items are backend-deploy actions on the maintainer's side.

## Live verification (signed-in, real preview run)

Playwright, viewport 1280x1800, real account (credentials never printed or screenshotted).

| Step | Result |
| --- | --- |
| Login → lands on `/downloads` | PASS |
| Save PDF to My Library, reopen from `Open` | PASS — 4 canvases rendered from the local copy |
| Header initial state in reader | `top:-32, opacity:0, visibility:hidden` — no leftover strip |
| Tap 1 | header visible (`top:16, opacity:1`) |
| Tap 2 | hidden again — **one tap = one toggle**, no double-fire |
| `history.back()` | reader closed, stayed on `/downloads` (page did not navigate away) |
| Console errors during run | `[]` (dev-only `lovable-tagger` ref warnings excluded — not present in prod) |

Tests: 64 passed across reader-fullscreen, rotationFrame, pdfViewer-regression, pdf-system,
useOverlayBackClose, libraryImport.regression, libraryLinkItems, nbDownload-memory.

## Findings

### [MEDIUM] [RELY] Reader mounted without a crash shield outside Downloads — FIXED
**Where:** `src/components/course/StudyMaterialsList.tsx`, `src/components/lesson/LessonAttachmentsSheet.tsx`
**Evidence:** only `src/pages/Downloads.tsx:370` wrapped `DocReaderShell` in `ReaderErrorBoundary`;
the other two mounts rendered it bare.
**Why it matters:** a pdf.js worker death / OOM / WebView trim-memory detach inside the reader
escaped to the route-level boundary and blanked the whole course or lesson page instead of
closing just the reader — the worst-case exam-week failure on a low-RAM Android.
**Fix:** both mounts now wrap the shell in `ReaderErrorBoundary` with `resetKey={viewer.url}` and
their existing `onBack`, matching the Downloads pattern.
**Regression guard:** `rg -n "<DocReaderShell" src/` must show every mount preceded by a
`ReaderErrorBoundary` wrapper.

### [LOW] [OBS] Dev-only console noise
`lovable-tagger` emits `forwardRef` warnings in the preview only; not shipped in the APK. No action.

## Lens results

- **app-crash-shield** — gap found and fixed (above). `CrashShield`, `ErrorBoundary`,
  `PlayerErrorBoundary`, `ReaderErrorBoundary` all present and wired.
- **capacitor-back-button** — reader owns its history sentinel (`useOverlayBackClose(..., "doc-reader")`);
  verified live that back closes the reader instead of leaving the page. Single back listener.
- **perf-exam-ready** — relayout after header transition is idle-scheduled; only visible pages
  render; streaming flags (`disableAutoFetch:false`, `disableStream:false`) untouched.
- **console-error-triage / sentry-triage** — zero runtime errors in the live run; the 7 Sentry
  issues remain as triaged in `2026-08-31-sentry-triage.md`, top one caused by the allowlist bug.
- **red-team-security-audit / supabase-architect-auditor** — no `service_role` key or live payment
  secret in `src/` (only string-prefix checks). `pdf-proxy` keeps all SSRF guards: IP literals
  rejected, redirect hops re-checked against `isAllowedPdfUrl`, dynamic allowlist read with the
  service role but never widened client-side. `/admin/trusted-hosts` is behind `AdminRoute`.
  Access token is attached only to our own `pdf-proxy` origin.
- **asset-optimization / mobile-view-expert / soft-touch / capacitor-video-player-master** —
  N/A for this scope; no assets, layout tokens or video paths changed.

## Still on the maintainer

1. Run `docs/db/2026-08-31-trusted-hosts-pdf-category.sql` and redeploy `pdf-proxy` — the deployed
   build still answers `400 "URL not allowed"` for the NCERT / crwilladmin links.
2. Attach the three approved PDFs to Amar Batch via the live admin upload UI.
3. `npx cap sync android && ./gradlew assembleDebug` for the device APK test.
