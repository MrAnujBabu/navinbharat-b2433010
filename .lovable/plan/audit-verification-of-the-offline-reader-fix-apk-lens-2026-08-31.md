# Audit + verification of the offline reader fix (APK lens)

Four lenses were requested. Here is what the pre-audit reads found, and what I propose to do about it.

## Finding 1 (HIGH) — the tap fix can now toggle the header twice

`DocReaderShell` has **two** tap paths into the same handler:

- the rotation frame's `onClick={handleSurfaceTap}` (line 453)
- the newly added `onSurfaceTap={handleSurfaceTap}` passed into `PdfViewer` (line 579), which `PdfViewer` attaches to its own wrapper and forwards to `FastPdfReader`

Where the click *does* bubble (online PDFs, web preview, iframe-free canvas), both fire on one tap, so the header toggles off and immediately back on — it looks like "tap does nothing". Offline `blob:` sources bubbled poorly, which is why the fix worked there.

Fix: make the tap single-source. Keep `onSurfaceTap` as the only handler for the viewer area, and have the surface handler stop propagation (or drop the frame-level `onClick` and keep it only on non-viewer padding). Then re-check both online and offline paths.

## Finding 2 (MEDIUM) — no back-button sentinel for the reader overlay

The capacitor-back-button contract expects a fullscreen overlay to push `{ pdfFullscreen: true }` on open. `DocReaderShell` never pushes one; only its *callers* protect it (`Downloads.tsx`, personal-library `FolderView` use `useOverlayBackClose`). `StudyMaterialsList` and `LessonAttachmentsSheet` mount `DocReaderShell` with no sentinel, so hardware back there leaves the page instead of closing the reader.

Fix: give `DocReaderShell` its own `useOverlayBackClose(true, onBack, "doc-reader")` so every caller inherits the contract, and confirm the callers that already register one don't double-pop.

## Finding 3 (INFO) — CI e2e monitor has nothing to check here

This project contains no `.github/workflows/`, no `maestro/` flows and no `e2e/` specs — they were not part of the imported source. So the Maestro/Playwright signature table has no target. If you want APK-level device verification, those pipelines have to be added first (separate task).

## Finding 4 (perf) — extra relayouts on each header toggle

Every header show/hide now fires `notifyPortalHostChanged()` + a synthetic `resize` after 320ms, and fullscreen fires the same after 260ms. On a low-RAM Android that re-rasterises visible PDF canvases on *every tap*. The fullscreen hook already debounces its own relayout onto an idle frame; the new toggle effect does not.

Fix: debounce/idle-schedule the header-toggle relayout the same way (and skip it when only `landscape` is unchanged), so tapping the page repeatedly can't queue a chain of re-rasterises.

## Work plan

1. De-duplicate the surface tap so one tap = one toggle, online and offline.
2. Add the overlay history sentinel inside `DocReaderShell`, verifying no double-close in `Downloads` / `FolderView`.
3. Idle-debounce the header-toggle relayout.
4. Verify: run `reader-fullscreen`, `rotationFrame`, `pdfViewer-regression` and `pdf-system` tests, plus a Playwright pass on the reader (header visible → tap → hidden → tap → visible) and a check that no blank strip remains.
5. Report the audit in the senior-architect-audit format with a rating.

## Technical notes

- Files touched: `src/components/library/DocReaderShell.tsx` only (plus a possible small prop tweak in `src/components/video/PdfViewer.tsx` if stopPropagation belongs there).
- No backend, no data, no build-pipeline changes.
- APK-specific behaviour (immersive mode, status bar, safe-area) is untouched.
