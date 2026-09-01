# Instant library add + reader mobile polish

## 1. Fix: new file appears in My Library only after a delay

Confirmed cause in `useFolderItems` (`src/hooks/usePersonalLibrary.ts`): its `refresh()` starts with `if (inflightRef.current) return;` — a refresh request that arrives while another is running is **dropped entirely**, with no "run once more afterwards" retry. The sibling hook `usePersonalLibrary` already does this correctly (it sets `pendingRef` and re-runs).

That is exactly the add path: saving from Downloads / Save-offline writes to IndexedDB and fires `personalLibrary:refresh` while the grid is often still mid-read, so the newly added row is never picked up — it only shows on the next unrelated refresh (navigating back, pull-to-refresh, or a later event).

Fix:
- Add the same coalescing (`pendingRef` + re-run after completion) to `useFolderItems.refresh`, so no refresh request is ever lost.
- Debounce burst events (bulk "Move to My Library" fires one event per item) with a short trailing window so a batch of 20 adds does one final read instead of 20.
- Make the refresh listener also run when the tab was hidden at event time: currently `if (!document.hidden) refresh()` silently drops the event; instead remember it and refresh on the next `visibilitychange`.
- Add an optimistic row for the link/offline-save path (device-file adds already have one) so a save from Downloads shows a tile immediately, replaced by the real record on refresh.

Test: extend the existing library vitest specs with a case that fires `personalLibrary:refresh` while a `listItems` promise is still pending and asserts the item lands in state.

## 2. Reader mobile UI polish

Applied to the offline/local reader (`DocReaderShell` + `FastPdfReader`) — presentation only, no change to the loading/streaming logic.

- **Page number display (offline PDFs).** The Drive-style pill (`PageIndicatorPill`) currently only appears while scrolling and needs the scroll element to resolve. Make it show a persistent `12 / 240` chip whenever the reader chrome is visible, plus the existing auto-fade behaviour during scroll, and verify it binds correctly for `blob:`/`capacitor:` sources.
- **Zoom.** Keep pinch and double-tap as-is; add small `−` / `%` / `+` controls in the reader chrome (with a "Fit width" reset on tapping the percentage), so zoom is reachable one-handed. Reuse the existing `anchorAfterCommit` commit path — no new zoom math.
- **Page turn.** Enlarge the pill's chevrons to comfortable touch targets and add optional edge-tap page turn (tap left/right third of the page to go previous/next) behind the existing tap handler, without breaking the header toggle tap.
- **Search.** Add an in-reader search bar (magnifier in the header) using pdf.js `findController` on the canvas reader: query input, match count `3/17`, next/previous, highlight and scroll-to-match, Escape/back to close. Wire it into the existing back-button sentinel so hardware back closes search before closing the reader.

## Technical notes

- Files touched: `src/hooks/usePersonalLibrary.ts`, `src/lib/linkOfflineSave.ts` (optimistic emit), `src/components/viewer/PageIndicatorPill.tsx`, `src/components/library/DocReaderShell.tsx`, `src/components/video/FastPdfReader.tsx`, plus a new search component under `src/components/viewer/`.
- Design tokens only for the new controls; touch targets ≥ 44px; safe-area padding respected so nothing sits under the notch or gesture bar.
- Canvas memory budget (`pdfCanvasBudget`) and the DPR clamp stay untouched — search highlighting reuses already-rendered text layers.
- Verification: `bun run typecheck`, existing vitest suite plus the new refresh-coalescing test, and a Playwright pass on `/downloads` (save a file, confirm it appears without delay; open it, check page chip, zoom controls and search).
