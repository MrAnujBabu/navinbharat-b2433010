# Autoscroll + My Library ko dusre project me kaise le jayein

Ye guide Naveen Bharat ke do feature bundles ko kisi bhi dusre Lovable project (Vite + React 18 + Tailwind v3, optional Capacitor) me port karne ke liye hai.

---

## A. Feature kya hai

**1. Autoscroll (reader ke andar)**
- Floating FAB se start/stop, speed presets `0.02x → 20x`, reverse scroll.
- Long-press par settings sheet: Pause-at (Odd / Even / Every page / Custom / Route), Pause-for (10/20/30/60s), A4 Sheet mode.
- Dwell engine page boundary detect karke rukta hai, phir apne aap aage badhta hai.
- Page indicator pill (`12 / 240`) jo reader chrome visible hone par pinned rehta hai.

**2. My Library (Downloads page ka offline library)**
- IndexedDB me folders + items (PDF/doc/image), device se add ya link se save-offline.
- Instant add: `personalLibrary:refresh` window event + coalescing refresh (mid-read event drop nahi hota).
- Quota/storage manager, rename/move/duplicate/reorder/export.
- Reader shell: zoom pill (`− 100% +`, 44px targets, safe-area aware), text search (`1/12` counter, up/down jump), page chip, hardware back se close, canvas memory budget.

---

## B. Copy karne wali exact files

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

My Library (data + logic)
  src/lib/personalLibraryDB.ts
  src/lib/personalLibraryQuota.ts
  src/services/personalLibrary.ts
  src/hooks/usePersonalLibrary.ts
  src/lib/linkOfflineSave.ts
  src/lib/fetchDocumentBlob.ts
  src/lib/detectFileType.ts
  src/lib/pdfCanvasBudget.ts

My Library (UI)
  src/components/library/personal/          (MyLibrary, FolderGrid, FolderView,
                                             AddFromLinkDialog, FolderNameDialog,
                                             ManageFoldersDialog, MoveTargetDialog,
                                             PersonalLibraryGate)
  src/components/library/DocReaderShell.tsx
  src/components/library/UniversalFileViewer.tsx
  src/components/library/ReaderErrorBoundary.tsx
  src/components/library/reader/ReaderSearchBar.tsx
  src/components/library/reader/ReaderZoomControls.tsx
  src/components/library/reader/StorageManagerSheet.tsx
  src/components/video/FastPdfReader.tsx
  src/components/video/PdfViewer.tsx
  src/components/video/PdfViewerWithAutoScroll.tsx

Support (dono ke liye)
  src/hooks/useReaderChrome.ts
  src/hooks/useOverlayBackClose.ts
  src/lib/native/haptics.ts        (Capacitor ho to; warna no-op stub)
  public/pdfjs/**                  (pdf.js worker + cmaps + standard_fonts)
```

### Hard dependencies

| Cheez | Kyun chahiye | Web-only project me |
|---|---|---|
| `public/pdfjs/**` assets | canvas PDF render + text search | **zaroori** (poora folder copy karo) |
| `@capacitor/filesystem` | native file save/open | drop karo, `isNative()` false hoga |
| `@capacitor/haptics` | tap feedback | optional, stub bana do |
| shadcn `button`, `dialog`, `sheet`, `input`, `scroll-area` | UI primitives | zaroori |
| Tailwind design tokens (`--card`, `--foreground`, `--border`, `--muted`) | components hardcoded colors use nahi karte | zaroori |
| `lucide-react` | icons | zaroori |

Safe to drop: `ReaderDebugPanel.tsx`, `src/lib/reader/fsrsScheduler.ts` (spaced repetition, alag feature), notes panel (`NotesPanel`, `NoteToolbar`, `MarkdownPreview`) agar notes nahi chahiye.

---

## C. Integration steps

1. **Assets pehle**: `public/pdfjs/` poora copy karo, warna reader blank rahega.
2. **Tokens**: target project ke `index.css` me `--card / --card-foreground / --foreground / --muted / --border / --background` defined hone chahiye (shadcn default theme me already hain).
3. **My Library mount**: kisi bhi page par
   ```tsx
   import MyLibrary from "@/components/library/personal/MyLibrary";
   // <MyLibrary />  — apna folder/item state khud manage karta hai
   ```
4. **Autoscroll mount**: kisi bhi scroll container ke saath
   ```tsx
   const scrollRef = useRef<HTMLElement | null>(null);
   <ReaderOverlays targetRef={scrollRef} bottomOffset={96} visible={chrome.visible} />
   ```
   Ya seedha `PdfViewerWithAutoScroll` use karo — wo FAB + chrome + page pill sab wire kar deta hai.
5. **Refresh event contract**: library me kuch bhi add/delete/move karne ke baad
   ```ts
   window.dispatchEvent(new Event("personalLibrary:refresh"));
   ```
   `useFolderItems` isko coalesce karta hai (in-flight read ke dauran aaya event drop nahi hota) aur backgrounded state ka event `visibilitychange` par replay hota hai. **Ye logic mat badalna** — yahi instant-add fix hai.
6. **Back button** (Capacitor): reader/search overlays `useOverlayBackClose` use karte hain, isse hardware back pehle search band karta hai, phir reader.

---

## D. Lovable ko dene wale ready prompts

### Option 1 — Public GitHub repo se

Pehle repo public karo:
`GitHub → repo → Settings → General → niche "Danger Zone" → Change repository visibility → Public → confirm`.
(Private hi rakhna hai to Option 2 use karo — Lovable private repo tabhi padh sakta hai jab wo project usi GitHub account se connected ho.)

Phir naye project ke chat me ye paste karo:

```text
Is public repo se do feature port karo: https://github.com/MrAnujBabu/Navinbharat

Copy karne wali files (path exactly same rakhna):

Autoscroll:
src/hooks/useAutoScroll.ts
src/lib/reader/dwellEngine.ts
src/components/viewer/AutoScrollFab.tsx
src/components/viewer/AutoScrollSheet.tsx
src/components/viewer/ChipGrid.tsx
src/components/viewer/autoScrollLimits.ts
src/components/viewer/ReaderOverlays.tsx
src/components/viewer/PageIndicatorPill.tsx

My Library:
src/lib/personalLibraryDB.ts
src/lib/personalLibraryQuota.ts
src/services/personalLibrary.ts
src/hooks/usePersonalLibrary.ts
src/lib/linkOfflineSave.ts
src/lib/fetchDocumentBlob.ts
src/lib/detectFileType.ts
src/lib/pdfCanvasBudget.ts
src/components/library/personal/**
src/components/library/DocReaderShell.tsx
src/components/library/UniversalFileViewer.tsx
src/components/library/ReaderErrorBoundary.tsx
src/components/library/reader/ReaderSearchBar.tsx
src/components/library/reader/ReaderZoomControls.tsx
src/components/library/reader/StorageManagerSheet.tsx
src/components/video/FastPdfReader.tsx
src/components/video/PdfViewer.tsx
src/components/video/PdfViewerWithAutoScroll.tsx
src/hooks/useReaderChrome.ts
src/hooks/useOverlayBackClose.ts
public/pdfjs/**  (poora folder, ye pdf.js worker hai)

Rules:
- Logic/algorithms bilkul mat badalna (khaas kar usePersonalLibrary ka refresh
  coalescing aur pdfCanvasBudget ka canvas release) — sirf imports aur design
  tokens is project ke hisaab se adapt karna.
- Hardcoded color utilities mat lagana, semantic tokens hi use karna.
- Missing npm packages install kar dena (pdfjs-dist, lucide-react, shadcn
  button/dialog/sheet/input).
- Agar ye project Capacitor nahi hai to @capacitor/* imports ko isNative()
  guard ke peeche no-op stubs se replace karna.
- Ant me: /downloads jaisa ek page banao jisme <MyLibrary /> mount ho, aur
  reader me autoscroll FAB + zoom pill + search + page chip kaam kare.
  Typecheck aur build green karke batao.
```

### Option 2 — Repo private rehna hai (zip upload)

1. Upar wali file list ke folders ko zip karo (ya poora repo zip karke bhejo).
2. Naye project ke chat me zip attach karke ye paste karo:

```text
Attached zip Naveen Bharat app ka source hai. Isme se sirf ye paths extract
karke is project me lagao: [upar wali list paste karo]

Baaki repo ignore karna. Rules wahi:
- logic as-is rakhna, sirf imports/tokens adapt karna
- public/pdfjs poora copy karna warna PDF reader blank rahega
- Capacitor plugins missing hon to isNative() guard ke saath stub
- ek /library route banake <MyLibrary /> mount karna, phir typecheck + build
```

---

## E. Gotchas

- **IndexedDB name clash**: `personalLibraryDB.ts` me DB name fixed hai. Agar target project me pehle se koi library DB hai to naam badal do, warna version conflict me store khul nahi payega.
- **pdf.js version pin**: `public/pdfjs/` ke assets aur `pdfjs-dist` package ka version match karna chahiye. Mismatch = "API version does not match Worker version".
- **Canvas budget mat hatana**: `pdfCanvasBudget.ts` 20-page window ke bahar ke canvases release karta hai. Isko hata doge to 500+ page PDF par Android WebView OOM crash karega.
- **Safe-area**: zoom pill aur FAB `env(safe-area-inset-bottom)` use karte hain; target project ke `index.html` me `viewport-fit=cover` hona chahiye.
- **Blob/capacitor URLs**: offline files `blob:` ya `capacitor://` se load hoti hain — target project ki CSP me `blob:` allowed rakhna.
- **Refresh event**: naye code me library mutate karo to `personalLibrary:refresh` dispatch karna mat bhoolna, warna instant-add wapas "kuchh der baad" wala behaviour dikhayega.
