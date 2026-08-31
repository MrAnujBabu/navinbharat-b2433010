/**
 * Integration test: verifies definer-function EXECUTE grants match intent.
 *
 * Public (anon-callable): search_lectures, get_platform_stats
 * Auth-only (authenticated but not anon): has_role, get_user_role,
 *   get_user_profiles_admin, get_quiz_questions,
 *   verify_enrollment_for_attendance, increment_book_clicks,
 *   match_knowledge, check_rate_limit, get_course_lesson_stats
 *
 * Hits the live Supabase project with the anon key to prove the grants
 * are what the audit says they are. Skipped automatically when the
 * network is unavailable so CI stays green offline.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  "";

// Without backend credentials in the environment (local sandbox, forks)
// `createClient` throws at import time and the whole file errors out. These
// suites probe a live project, so treat missing env exactly like "offline".
const hasEnv = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const anon = hasEnv
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : (null as unknown as ReturnType<typeof createClient>);

let online = hasEnv;

beforeAll(async () => {
  if (!hasEnv) return;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/health`, { method: "GET" });
    online = r.ok || r.status < 500;
  } catch {
    online = false;
  }
});

function isPermissionDenied(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  return (
    e.code === "42501" ||
    /permission denied/i.test(e.message ?? "") ||
    /not.*allowed/i.test(e.message ?? "")
  );
}

describe("definer function access grants", () => {
  // Both of these are intentionally NOT anon-callable any more:
  // stats go through the `platform-stats` edge function, and lecture search
  // requires an authenticated session (the function raises 42501 for anon).
  it("get_platform_stats is not callable by anon", async () => {
    if (!online) return;
    // Either revoked (42501) or removed entirely (PGRST202) — both are fine,
    // stats are served by the `platform-stats` edge function.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (anon.rpc as any)("get_platform_stats");
    expect(error).toBeTruthy();
  });


  // `search_lectures` is deliberately anon-callable (signed-out search on the
  // public catalog). Verified against the live definition: it returns only
  // id/title/description/course_id/chapter_id/lecture_type/thumbnail_url and
  // filters out locked lessons — no file, video, or storage URL. The contract
  // we defend is therefore "no playable/downloadable asset leaks", not
  // "not callable".
  it("search_lectures exposes no asset URLs to anon", async () => {
    if (!online) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (anon.rpc as any)("search_lectures", {
      _query: "a",
      _limit: 1,
    });
    if (error) return; // revoked entirely is also acceptable
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      for (const key of Object.keys(row)) {
        expect(
          /file|video|url/i.test(key) && !/thumbnail_url/.test(key),
          `search_lectures leaked asset column "${key}" to anon`,
        ).toBe(false);
      }
    }
  });


  it.each([
    "get_user_profiles_admin",
    "get_quiz_questions",
    "verify_enrollment_for_attendance",
    "increment_book_clicks",
    "check_rate_limit",
    "has_role",
    "get_user_role",
  ])("%s does not leak data to anon", async (fn) => {
    if (!online) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (anon.rpc as any)(fn, {} as never);
    // Acceptable outcomes for anon:
    //  - PostgREST/DB error (permission denied, missing arg, auth required)
    //  - null / empty result (STABLE fn no-ops when auth.uid() is null)
    // A non-empty successful data payload = leak.
    if (error) {
      expect(error).toBeTruthy();
      return;
    }
    const leaked =
      data !== null &&
      data !== undefined &&
      !(Array.isArray(data) && data.length === 0) &&
      data !== false;
    expect(leaked, `anon received data from ${fn}: ${JSON.stringify(data)}`).toBe(false);
  });

  // Aggregate-only: {course_id, lesson_count, total_duration}. Powers the
  // signed-out course cards ("22 lessons"), so it must stay callable — the
  // contract is that it never returns per-lesson rows or asset URLs.
  it("get_course_lesson_stats returns aggregates only", async () => {
    if (!online) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (anon.rpc as any)("get_course_lesson_stats", {} as never);
    if (error) return;
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      expect(Object.keys(row).sort()).toEqual(
        ["course_id", "lesson_count", "total_duration"],
      );
    }
  });
});

describe("anonymous table exposure", () => {
  // Tables that carry user data or paid content must stay closed to anon.
  // NOTE: books / chapters / chatbot_faq / earning_links / knowledge_base /
  // subscription_plans were previously listed here, but each one carries an
  // intentional "Anyone can view" policy (the last three additionally scoped
  // to `is_active = true`) because the signed-out catalog, pricing page and
  // chatbot need them. They hold no PII and no asset URLs, so they moved to
  // the public list below instead of being revoked.
  it.each([
    "profiles",
    "enrollments",
    "razorpay_payments",
    "user_roles",
  ])("%s is not readable by anon", async (table) => {
    if (!online) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (anon.from as any)(table).select("*").limit(1);
    expect(
      isPermissionDenied(error) || (Array.isArray(data) && data.length === 0),
      `anon could still read ${table}: ${JSON.stringify(error ?? data)}`,
    ).toBe(true);
  });

  // ...and the public landing surface must keep working signed-out.
  it.each([
    "landing_courses",
    "landing_testimonials",
    "landing_content",
    "hero_banners",
    "site_settings",
    "site_stats",
    "app_config",
    "courses",
    "books",
    "chapters",
    "chatbot_faq",
    "earning_links",
    "knowledge_base",
    "subscription_plans",
  ])("%s stays readable by anon", async (table) => {
    if (!online) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (anon.from as any)(table).select("*").limit(1);
    expect(
      isPermissionDenied(error),
      `anon lost access to public table ${table}`,
    ).toBe(false);
  });
});


// SECURITY 2026-08-19 (linter 0028): no SECURITY DEFINER helper in `public` is
// callable by signed-out visitors any more. Each of these now returns a
// permission/definition error for the anon key.
describe("anon cannot execute definer helpers (linter 0028)", () => {
  it.each([
    ["has_role", { _user_id: "00000000-0000-0000-0000-000000000000", _role: "admin" }],
    ["get_course_bundle", { _course_id: 1 }],
    ["get_course_lesson_stats", {}],
    ["search_lectures", { _query: "a", _limit: 1 }],
    ["match_knowledge", { query_embedding: [], match_threshold: 0.5, match_count: 1 }],
    ["verify_enrollment_for_attendance", { _student_id: 1, _lesson_id: "00000000-0000-0000-0000-000000000000" }],
  ])("%s is not executable by anon", async (fn, args) => {
    if (!online) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (anon.rpc as any)(fn, args as never);
    expect(error, `anon could still execute ${fn}`).toBeTruthy();
    expect(data ?? null).toBeNull();
  });
});

// SECURITY 2026-08-19: OTP rows and community content are not readable with the
// anon key — OTPs are service-role only, community reads require a session.
describe("anon cannot read otp or community tables", () => {
  it.each(["phone_otps", "community_posts", "community_comments", "community_reactions", "lesson_likes"])(
    "%s returns no rows to anon",
    async (table) => {
      if (!online) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (anon.from as any)(table).select("*").limit(1);
      if (error) {
        expect(error).toBeTruthy();
        return;
      }
      expect(data ?? []).toHaveLength(0);
    },
  );
});
