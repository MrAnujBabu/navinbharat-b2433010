# Fix offline PDF reader header (My Library / Save offline)

## Problem

When a PDF is opened from a locally saved copy (My Library, or a file saved offline), the top bar behaves wrong:

1. Tapping the page (and using the fullscreen button) does not hide the "Physics"-style top bar.
2. When it does move away, a leftover white/blank strip stays across the top instead of the page going edge to edge.

Online PDFs behave correctly, so the fix must be scoped to the shared library reader without changing the online behaviour.

## What we know from the code

- Both cases use the same shell: `src/components/library/DocReaderShell.tsx`.
- Its top bar visibility is a `headerVisible` flag; the bar slides via `-translate-y-full`, and the PDF surface is offset with `top: headerVisible && !landscape ? headerHeight : 0`.
- Tap-to-toggle lives in `handleSurfaceTap`, wired as an `onClick` on the rotation frame — the shell does not pass `onSurfaceTap` down to `PdfViewer`/`FastPdfReader`, so it depends entirely on the tap bubbling out of the canvas surface.
- The exact reason the tap is lost for local files (`blob:` / `capacitor:` sources) is not yet confirmed — that is the first step, not an assumption.

## Plan

1. Reproduce in the preview with a locally saved PDF (blob source) and instrument the tap path: log `handleSurfaceTap`, confirm whether the click reaches the shell, and whether the page-selection / canvas layer swallows it.
2. Fix the toggle so tapping the page always toggles the bar for local sources:
   - Pass `onSurfaceTap` explicitly from `DocReaderShell` into `PdfViewer` (which already forwards it to both the canvas and iframe branches) instead of relying on bubbling.
   - Make the fullscreen button's hide path authoritative so entering fullscreen always clears the bar.
3. Fix the leftover strip:
   - When the bar is hidden, ensure the surface collapses to `top: 0` and the notch band / safe-area padding does not keep reserving space.
   - Re-measure the canvas after the transition (dispatch the existing resize/portal notification) so the rendered page refills the reclaimed height rather than keeping the pre-hide letterbox.
4. Verify with Playwright screenshots at the same viewport as the screenshots: bar visible, after tap, and in fullscreen — checking no white/blank band remains at the top, and re-check the online path for regressions.

## Technical notes

- Files touched: `src/components/library/DocReaderShell.tsx` (primary), and only if needed `src/components/video/PdfViewer.tsx` for tap forwarding.
- No backend, data, or download-pipeline changes; this is presentation-layer only.
- Existing test `src/test/reader-fullscreen.test.tsx` will be run to confirm the fullscreen contract still holds.
