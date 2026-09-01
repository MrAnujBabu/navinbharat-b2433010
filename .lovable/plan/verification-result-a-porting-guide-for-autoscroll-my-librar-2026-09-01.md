# Verification result + a porting guide for Autoscroll & My Library

## 1. Verification (already done, no code change needed)

Latest build entry reads `build OK`, and the reader/library files named in the last summary all exist on disk:

- `src/hooks/usePersonalLibrary.ts` — coalescing refresh (`pendingRef`), missed-event replay (`missedRef` + `visibilitychange`), 30ms burst debounce.
- `src/components/library/reader/ReaderSearchBar.tsx`, `ReaderZoomControls.tsx` — search bar and the floating `− 100% +` pill with 44px targets and safe-area offset.
- `src/components/viewer/PageIndicatorPill.tsx` + `ReaderOverlays.tsx` — pinned page chip.

No further edits are proposed for this part. If you want a fresh live pass, I can re-run the Playwright check on `/downloads` at 390px after approval.

## 2. What I will add: a portable feature guide

Create `docs/porting/autoscroll-my-library.md` — a single markdown file you can hand to any other Lovable project. Contents:

**A. What the feature is**
Short description of the two bundles: Autoscroll (speed presets, dwell/pause-at-page, A4 mode, FAB + settings sheet) and My Library (offline folders/items in IndexedDB, add from device or link, instant refresh, reader with zoom/search/page chip).

**B. Exact file manifest to copy**

```text
Autoscroll
  src/hooks/useAutoScroll.ts
  src/lib/reader/dwellEngine.ts
  src/components/viewer/AutoScrollFab.tsx
  src/components/viewer/AutoScrollSheet.tsx
  src/components/viewer/ChipGrid.tsx
  src/components/viewer/autoScrollLimits.ts
  src/components/viewer/ReaderOverlays.tsx
  src/components/viewer/PageIndicatorPill.tsx

My Library
  src/lib/personalLibraryDB.ts
  src/lib/personalLibraryQuota.ts
  src/services/personalLibrary.ts
  src/hooks/usePersonalLibrary.ts
  src/components/library/personal/*        (MyLibrary, FolderGrid, FolderView, dialogs, gate)
  src/components/library/DocReaderShell.tsx, UniversalFileViewer.tsx, ReaderErrorBoundary.tsx
  src/components/library/reader/ReaderSearchBar.tsx, ReaderZoomControls.tsx
  src/lib/linkOfflineSave.ts, fetchDocumentBlob.ts, detectFileType.ts, pdfCanvasBudget.ts
```

Each group lists its hard dependencies (pdf.js worker assets in `public/pdfjs`, Capacitor Filesystem/Haptics plugins, shadcn `dialog`/`sheet`/`button`, Tailwind design tokens) and the ones that are safe to drop in a web-only project.

**C. Integration steps** — where to mount `MyLibrary`, how to render `AutoScrollFab` next to any scroll container, the `personalLibrary:refresh` window event contract, and the tokens (`--card`, `--foreground`, …) the components expect in `index.css`.

**D. Two ready-to-paste Lovable prompts**
1. *Repo-link prompt* — for when the target project should pull the code from a public GitHub repo: how to make the repo public (GitHub → Settings → General → Change visibility → Public), then a prompt naming the repo URL and the exact file paths to copy, plus the "adapt to my design tokens, don't rewrite the logic" instruction.
2. *Zip/manual prompt* — for when the repo stays private: export the folders listed above, upload the zip in chat, and the prompt that tells Lovable to extract only those paths.

**E. Gotchas** — IndexedDB name collisions, the pdf.js version pin, Capacitor-only APIs guarded by `isNative()`, and to keep the canvas budget so large PDFs don't OOM.

## Technical notes

- The guide is documentation only; no source files change.
- Written in the same Hindi/English mix you use, with copy-paste prompt blocks in fenced code so nothing is reformatted on paste.
