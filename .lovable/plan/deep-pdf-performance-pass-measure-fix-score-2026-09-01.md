# Deep PDF performance pass — measure, fix, score

Goal: the PDF reader (lesson notes, My Library, offline saves) opens fast, scrolls smoothly, never OOMs, and finishes with zero errors in console, tests, typecheck and build. Every metric gets a numeric score so "better/worse" is not a matter of opinion.

## 1. Baseline first (no guessing)

Record numbers before touching code, into `docs/perf/BASELINE-2026-09-01.md`:

- Production build, then per-chunk raw + gzip sizes (`scripts/measure-perf.ts`) and budget check (`scripts/check-bundle-size.mjs`).
- Live Playwright run on the preview, signed in, on the real reader surface:
  - cold open of a saved offline PDF (time to first rendered page canvas)
  - warm re-open of the same PDF
  - scroll through pages: frame timing, JS heap before/after
  - tap-to-toggle header latency
  - console + network errors captured for the whole run
- Reader-route JS weight: how much pdf.js/worker payload lands on cold open.

## 2. Scoring model ("ELO parameter")

Each metric gets a 0-100 sub-score against an explicit budget, then a weighted overall rating out of 1000 shown as a before/after table.

| Metric | Budget | Weight |
|---|---|---|
| Cold open, saved PDF | < 1.5s | 20% |
| Warm open | < 1.0s | 10% |
| Reader route JS gzip | <= 220KB | 15% |
| Peak JS heap, 50-page scroll | < 250MB | 15% |
| Scroll long-frame ratio | < 10% | 15% |
| Header tap-to-paint | < 200ms | 10% |
| Console/runtime errors | 0 | 15% |

A run only passes when the error metric is a perfect score — any console error caps the whole rating.

## 3. Fixes (only what the measurements justify)

Applied in this order, re-measuring after each:

1. Anything the bundle report shows loading on the reader path that isn't needed for first paint gets split out.
2. Page slots: confirm only near-viewport pages mount and that off-screen canvases are released, so heap stays flat on long documents.
3. Streaming/range settings stay on for remote PDFs; check the local/offline path uses the setting that suits bytes already on disk, without re-buffering whole files.
4. Warm the reader chunk on idle from the pages that lead into it, so the first open isn't a cold module fetch.
5. Debounce/idle-schedule any repeated relayout or re-rasterisation triggered by scroll, rotation or header toggle.
6. Every reader effect cleans up: aborted fetches, destroyed pdf.js documents, removed listeners on unmount.

Hard constraints kept intact: PDFs always open in-app, only visible pages render, remote streaming stays enabled, splash safety timeout untouched, single back-button handler, no service worker, design tokens only.

## 4. Zero-error gate

Before reporting done:

- Full vitest suite green.
- Typecheck clean.
- Production build clean, bundle budgets pass.
- Live signed-in reader walkthrough with zero console errors and zero failed network requests (dev-only tagger warnings noted separately, not counted).

## 5. Deliverable

`docs/perf/PDF-PERF-2026-09-01.md` with: verdict, the before/after scoring table, each change and the metric it moved, anything that regressed, and follow-ups added to `roadmap.md`.

## Technical notes

- Measurement scripts live under `/tmp/browser/` and `scripts/`; no new runtime dependency is added for measurement.
- Playwright signs in with the test account already used for prior verification; credentials never printed.
- No backend migration is part of this pass. The three external NCERT/crwilladmin links still need the pending SQL run and `pdf-proxy` redeploy on your side, so their timings are measured through a local sample PDF instead.
