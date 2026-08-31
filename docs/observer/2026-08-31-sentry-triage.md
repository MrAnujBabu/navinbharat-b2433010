# Sentry Triage — Naveen Bharat — 2026-08-31

Connection verified: org `naveen-bharat` (us region), project `javascript-react`. 7 unresolved issues in the last 14 days, all from the APK/`/downloads` reader path. 0 affected users recorded (self-testing device).

## Summary

| # | Issue | Message | Events | Root cause | Sev | Cat | Owner |
|---|---|---|---|---|---|---|---|
| 1 | JAVASCRIPT-REACT-6 | `TypeError: network error` @ `/downloads` | 7 | pdf.js fetch aborted mid-Range on flaky mobile data; classified transient by `src/lib/nativePdfHttp.ts:162` but still reported | MEDIUM | RELY | `src/lib/sentry.ts:309` (should drop transient network class) |
| 2 | JAVASCRIPT-REACT-11 | `Error: TypeError: network error` @ `logger` chunk | 3 | Same event double-reported — once raw, once wrapped by the logger | MEDIUM | OBS | `src/lib/sentry.ts` beforeSend dedupe |
| 3 | JAVASCRIPT-REACT-10 | `UnknownErrorException: network error` | 3 | pdf.js wrapping of the same transport abort | LOW | RELY | same as #1 |
| 4 | JAVASCRIPT-REACT-14 | `InvalidPDFException: Invalid PDF structure` @ `/downloads` | 1 | Saved-offline blob was an HTML error page, not PDF bytes — the classic "URL not allowed" JSON body being cached as a PDF | HIGH | DATA | fixed by this change set (allowlist) + add a `%PDF` signature check before writing to offline storage (`src/hooks/useLocalPdfSource.ts`) |
| 5 | JAVASCRIPT-REACT-12 | `PGRST303 JWT issued at future` | 2 | Device clock ahead of server; PostgREST rejects the JWT | MEDIUM | RELY | surface a "check your phone's date & time" toast instead of an error report |
| 6 | JAVASCRIPT-REACT-15 | `Failed to connect to localhost/127.0.0.1:443` | 1 | Dev/preview build artifact running inside the APK WebView | LOW | CONFIG | ensure release APK never ships the dev server URL in `capacitor.config` |
| 7 | JAVASCRIPT-REACT-13 | `<unknown>` | 3 | Empty error object — no message/stack captured | LOW | OBS | drop `{}` payloads in `beforeSend` |

## Priority plan

**P1 — fixed / in this change set**
- #4: the three external PDF hosts were rejected by `pdf-proxy` (`URL not allowed`), so the saved bytes were a JSON error body. The admin allowlist + `pdf-proxy` dynamic host read fixes the cause. Follow-up: reject non-`%PDF` bytes before persisting offline.

**P2 — noise reduction (one PR)**
- #1/#2/#3/#7: single `beforeSend` pass — drop transient network class already handled by `nativePdfHttp`, dedupe logger-wrapped duplicates, drop empty `{}` events.

**P3**
- #5 clock skew UX, #6 config guard.

## Wins
- Errors carry route culprit (`/downloads`) and a stable transient-error classifier already exists.
- Crash volume is tiny (max 7 events) and no real users affected.

## Open questions
- Should transient network errors be dropped entirely, or kept as breadcrumbs only?
