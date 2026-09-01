# Code Quality & Logic Hardening Pass

No new features, no UI changes. Only correctness, safety and clarity fixes found by running the linter, typechecker and the 12 audit lenses over the current code.

## Current state (verified this turn)

- Build: OK. TypeScript: clean (`tsgo --noEmit`, zero errors).
- ESLint: **678 problems — 80 errors, 598 warnings** (41 errors inside `src/`).
- Largest files: `LessonView.tsx` (147KB), `AdminUpload.tsx` (86KB), `Admin.tsx` (83KB), `MahimaGhostPlayer.tsx` (81KB), `FastPdfReader.tsx` (69KB).

## Lane 1 — Real logic bugs (highest value)

1. **Conditional React hooks** — `UniversalFileViewer.tsx` calls `useEffect` after three early returns, and `personal/FolderGrid.tsx` calls six `useState` + a `useEffect` inside a nested component defined conditionally. Both break hook order and can crash or silently keep stale state when the branch flips (e.g. PDF → markdown in the same viewer). Fix: hoist hooks above the early returns; extract the inner component in `FolderGrid` to module scope.
2. **Component created during render** — `FormatFilterChips.tsx:75` defines a component inside render, so its whole subtree remounts on every parent render (chip filters lose focus/state, extra work on scroll). Extract it.
3. **Dead expression** — `FolderView.tsx:300` has a statement whose result is discarded; determine intent and either call it or delete it.
4. **Restricted imports that violate project rules** — `FastPdfReader.tsx` imports the native browser bridge (PDF surfaces must stay in-app) and `Install.tsx` imports `@capacitor/core` directly instead of via `@/lib/bridge`. Route both through the sanctioned wrappers.
5. **Raw `window.open` (2 sites)** — ejects users out of the Capacitor WebView and breaks the back stack. Replace with `openResource()`.

## Lane 2 — Error handling quality (crash-shield / sentry lenses)

- 5 `preserve-caught-error` violations (`MarkdownViewer` x2, `video/MarkdownViewer`, `native/camera`, `native/capacitorFunctionFetch`): rethrown errors drop the original `cause`, so Sentry shows a generic message with no upstream stack. Attach `{ cause }` so triage stops guessing.
- Sweep `catch {}` blocks in the reader/offline paths: anything user-visible routes through `reportError(err, { surface })`; anything intentionally silent gets a one-line reason comment.

## Lane 3 — Regex and string correctness

- 14 `no-useless-escape` errors (`pdf-proxy`, `resolve-doubt`, `resolve-storage-pdf`, `nativePdfSaver`, `pdfDisplayName`, `useStudyMaterials`, `AdminStudyMaterials`, `SmartNotesListSheet`). Each is a character class or path regex with a stray backslash — harmless today but a real bug the moment the pattern is edited. Clean them and confirm the matching behaviour is byte-identical with a quick unit assertion where the regex gates a security decision (`pdf-proxy` host matching especially).

## Lane 4 — Type safety

- 428 `any` occurrences across 121 files. Not a mass rewrite: fix `any` only where it hides a real contract — Supabase query results in `useLessonBookmarks`, `useLessonProgress`, `useProfiles`, `score-quiz`, `recover-enrollment`, and the `pdf-proxy` response shapes. Everything else stays as-is and is recorded as a follow-up.

## Lane 5 — React Compiler / memoization warnings

- Several hooks report "Existing memoization could not be preserved" (`useLessonBookmarks`, `useLessonProgress`, `useProfiles`, `Install`). These callbacks re-create every render and defeat downstream `memo()`. Stabilise the dependency shapes so memoization actually holds — this is the cheap half of the perf lens.

## Out of scope (deliberately)

- No behaviour changes to the PDF reader, back-button contract, streaming flags or design tokens.
- No file-splitting of the 80KB+ pages in this pass — flagged as a follow-up in `roadmap.md` with a suggested split, since moving that much code without tests is a regression risk.
- No new dependencies, no service worker, no CI scaffolding.

## Verification

- `tsgo --noEmit` stays clean.
- ESLint error count for `src/` goes 41 → 0; total error count 80 → 0 (warnings tracked, not required to reach 0).
- Full vitest suite green (reader, PDF sources, back button, library import).
- Build OK, and a signed-in Playwright pass over `/downloads` → open offline PDF → tap toggle → back, confirming zero console errors and no behaviour drift.
- Findings written to `docs/observer/2026-09-01-code-quality-pass.md` with before/after counts.
