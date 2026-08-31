# Plan: live end-to-end verification of the offline PDF reader

You gave a test account, so the one gap in the last audit — "no signed-in session, so the reader could not be driven end-to-end" — can now be closed. This run is verification only: no feature work unless it finds a real defect.

## What I'll do

1. **Sign in headlessly** with the supplied account against the running preview and land on `/downloads`. The credentials are used once inside the browser script and never printed, logged, or screenshotted.
2. **Walk the offline flow**
   - Open the admin PDF Links tab, confirm the three approved links are listed and the Test probe returns 206 / `application/pdf`.
   - Save one PDF to My Library, confirm the local copy is written and shows up in Downloads.
   - Open it offline (block network for the PDF host), confirm bytes come from the local source and not the proxy.
3. **Verify the header fix on the real surface**
   - Tap once: header hides, no leftover strip, page fills the reclaimed space.
   - Tap again: header returns. Screenshot before/after each tap.
   - Confirm one tap = one toggle (no double-fire) by counting toggles in the console.
4. **Check the back contract** — trigger the history-back path and confirm the reader closes instead of the page navigating away.
5. **Collect console + network errors** during the whole run and cross-check them against the seven Sentry issues already triaged.

## Deliverable

A short verification report appended to `docs/observer/2026-08-31-sentry-triage.md`, with pass/fail per step and screenshots for the header toggle. If any step fails, I stop and come back with a diagnosis before changing code.

## Technical notes

- Playwright/Chromium, viewport 1280x1800, driving `http://localhost:8080`; scripts and screenshots stay under `/tmp/browser/`.
- The sandbox is a plain Vite SPA — Capacitor `capacitor:` local sources fall back to `blob:` here, so the offline path gets exercised through the blob branch. Native-only behaviour (Filesystem plugin, hardware back key) still needs the device APK.
- No source files change in this run unless a step fails and you approve a fix.

## Still on you (unchanged)

- Run `docs/db/2026-08-31-trusted-hosts-pdf-category.sql` and redeploy `pdf-proxy`.
- Attach the three PDFs to Amar Batch via the live admin upload UI.
- `npx cap sync android && ./gradlew assembleDebug` for the APK device test.

Also: since these credentials were pasted in chat, rotate that password once testing is done.
