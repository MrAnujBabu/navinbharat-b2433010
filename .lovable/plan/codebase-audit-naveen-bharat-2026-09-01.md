# Codebase Audit — Naveen Bharat

**Rating: 4/5** — No critical issue found. The app is production-grade: build green, typecheck clean, 509/520 tests passing, admin routes role-gated, all HTML injection points sanitized or escaped, no secrets in code. What's left is hygiene: lint noise from a vendored file, backend warnings, and pre-existing test guards.

## Verdict on "koi critical issue?"

**Nahi — zero CRITICAL, zero HIGH.** Checks run in this audit:

| Check | Result |
|---|---|
| Typecheck (`tsgo -p tsconfig.app.json`) | clean, exit 0 |
| Build errors log | empty (build OK) |
| Security scan (Supabase + Lovable + Wiz) | 0 critical, 0 error-level, 2 warnings |
| Hardcoded color utilities in components | 0 matches |
| Secrets / service-role key in client code | none — only comments; `.env` holds publishable keys only |
| `dangerouslySetInnerHTML` sites (5) | all DOMPurify-sanitized or JSON-LD with `<`/`>`/`&` escaped |
| Admin routes | every `/admin/*` wrapped in `AdminRoute` with `isAdmin` + `roleLoaded` |
| Tests | 509 passed, 4 failed (all pre-existing CI-workflow guards) |

## Findings

### [MEDIUM] [CONFIG] 37 lint "errors" all come from a vendored file
`public/pdfjs/web/viewer.mjs` is pdf.js's shipped bundle; every error is "Definition for rule 'es/no-…' was not found" — the file carries upstream eslint comments for plugins this project doesn't install. It pollutes `bun run lint` and hides real regressions.
Fix: add `public/pdfjs/**` to the `ignores` array in `eslint.config.js`. Then the source tree is 0 errors.

### [MEDIUM] [SEC] Leaked-password protection disabled
Supabase Auth is not checking signups/resets against the breached-password list. One toggle in Auth settings on the Naveen Bharat project.

### [MEDIUM] [SEC] A `SECURITY DEFINER` function is executable by any signed-in user
Scanner flags at least one definer function reachable by `authenticated`. Needs a review of which function it is and either `REVOKE EXECUTE` or a role check inside it.

### [MEDIUM] [MAINT] 600 lint warnings, dominated by `any`
Heaviest: `src/pages/Admin.tsx` (21), `src/pages/LessonView.tsx` (17), `AdminUpload.tsx` (11), `AdminAnalytics.tsx` (11), plus edge functions (`score-quiz`, `resolve-doubt`, `recover-enrollment`). These mask Supabase type drift — a renamed column fails at runtime, not compile time.

### [LOW] [CONFIG] `.env` is not in `.gitignore`
It only contains `VITE_SUPABASE_PROJECT_ID` / `URL` / `PUBLISHABLE_KEY`, all safe to publish — so this is not a leak today. But with the repo public, the file becomes a footgun the day a private key lands in it.

### [LOW] [OBS] 4 failing tests guard CI files that don't exist
`src/test/observabilitySuite.test.ts` (and one sibling) assert on `.github/workflows` content. The workflows were never ported into this project, so the suite is permanently red — which trains everyone to ignore red.

## Wins

- Reader hardening is genuinely good: canvas budget (20-page window), error boundary on every `DocReaderShell` mount, refresh coalescing with backgrounded-event replay.
- Design tokens respected — zero hardcoded `text-white` / `bg-black` in components.
- SSRF-guarded `pdf-proxy` with a DB-backed allowlist instead of a hardcoded host list.
- JSON-LD blocks explicitly escape `<`, `>`, `&` — a detail most codebases miss.

## Fix Plan (if you approve)

1. Ignore `public/pdfjs/**` in `eslint.config.js` → lint drops to 0 errors.
2. Add `.env` to `.gitignore` (keep an `.env.example` with the same three key names).
3. Either delete the two CI-guard test files or gate them behind "skip if `.github/workflows` is absent", so the suite goes fully green.
4. Type the top 4 `any`-heavy pages against `src/types/supabase.ts` (Admin, LessonView, AdminUpload, AdminAnalytics).
5. Backend, needs your action on the Supabase dashboard: enable leaked-password protection; I identify the offending `SECURITY DEFINER` function and propose the `REVOKE`/role-check as SQL for you to run.

Steps 1–3 are low-risk and quick. Step 4 is the only one that touches real logic. Step 5 I can only prepare, not apply.
