// Admin-only Sentry proxy.
//
// The browser must never see SENTRY_AUTH_TOKEN, so every Sentry Web API call
// the Errors & Incidents page needs is funnelled through here behind an admin
// role check. Actions are an explicit allow-list — there is no free-form path
// parameter, so this cannot be turned into a generic Sentry API tunnel.
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireRole } from "../_shared/auth.ts";

const SENTRY_API = "https://sentry.io/api/0";

type Action = "issues" | "issue_events" | "update_issue" | "stats" | "config";

const ACTIONS: Action[] = ["issues", "issue_events", "update_issue", "stats", "config"];

/** Sentry issue ids are numeric; short ids are `PROJECT-ABC`. Accept both. */
const ISSUE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const STATS_PERIODS = ["24h", "7d", "14d", "30d"];
const STATUSES = ["resolved", "unresolved", "ignored"];

function json(body: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Relay a Sentry failure verbatim. A bare 500 here would leave the admin page
 * unable to tell "token missing a scope" from "org slug typo".
 */
async function relayError(res: Response, corsHeaders: Record<string, string>) {
  const details = await res.text().catch(() => "");
  console.error(`[sentry-report] Sentry request failed [${res.status}]: ${details.slice(0, 500)}`);
  return json(
    { error: "Sentry request failed", status: res.status, details: details.slice(0, 2000) },
    res.status,
    corsHeaders,
  );
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireRole(req, corsHeaders, ["admin"]);
  if (!auth.ok) return auth.response;

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Body must be JSON" }, 400, corsHeaders);
  }

  const action = String(payload.action ?? "");
  if (!ACTIONS.includes(action as Action)) {
    return json({ error: `action must be one of ${ACTIONS.join(", ")}` }, 400, corsHeaders);
  }

  const token = (Deno.env.get("SENTRY_AUTH_TOKEN") || "").trim();
  const org = (Deno.env.get("SENTRY_ORG_SLUG") || "").trim();
  const project = (Deno.env.get("SENTRY_PROJECT_SLUG") || "").trim();

  if (action === "config") {
    // Lets the page render a real setup hint instead of an empty table.
    return json(
      { configured: Boolean(token && org && project), org: org || null, project: project || null },
      200,
      corsHeaders,
    );
  }

  if (!token || !org || !project) {
    return json(
      {
        error: "Sentry is not configured",
        details: "SENTRY_AUTH_TOKEN, SENTRY_ORG_SLUG and SENTRY_PROJECT_SLUG must all be set.",
      },
      503,
      corsHeaders,
    );
  }

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  try {
    if (action === "issues") {
      const statsPeriod = STATS_PERIODS.includes(String(payload.statsPeriod))
        ? String(payload.statsPeriod)
        : "14d";
      const query = typeof payload.query === "string" ? payload.query.slice(0, 200) : "is:unresolved";
      const limit = Math.min(Math.max(Number(payload.limit) || 50, 1), 100);
      const url = new URL(`${SENTRY_API}/projects/${org}/${project}/issues/`);
      url.searchParams.set("statsPeriod", statsPeriod);
      url.searchParams.set("query", query);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("sort", String(payload.sort) === "date" ? "date" : "freq");

      const res = await fetch(url, { headers });
      if (!res.ok) return relayError(res, corsHeaders);
      const issues = await res.json();
      return json({ issues, org, project, statsPeriod, query }, 200, corsHeaders);
    }

    if (action === "issue_events") {
      const issueId = String(payload.issueId ?? "");
      if (!ISSUE_ID_RE.test(issueId)) return json({ error: "Invalid issue id" }, 400, corsHeaders);
      const res = await fetch(`${SENTRY_API}/issues/${issueId}/events/latest/`, { headers });
      if (!res.ok) return relayError(res, corsHeaders);
      return json({ event: await res.json() }, 200, corsHeaders);
    }

    if (action === "update_issue") {
      const issueId = String(payload.issueId ?? "");
      const status = String(payload.status ?? "");
      if (!ISSUE_ID_RE.test(issueId)) return json({ error: "Invalid issue id" }, 400, corsHeaders);
      if (!STATUSES.includes(status)) {
        return json({ error: `status must be one of ${STATUSES.join(", ")}` }, 400, corsHeaders);
      }
      const res = await fetch(`${SENTRY_API}/issues/${issueId}/`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return relayError(res, corsHeaders);
      return json({ ok: true, issueId, status }, 200, corsHeaders);
    }

    // action === "stats" — event volume buckets for the report header.
    const statsPeriod = STATS_PERIODS.includes(String(payload.statsPeriod))
      ? String(payload.statsPeriod)
      : "7d";
    const url = new URL(`${SENTRY_API}/organizations/${org}/stats_v2/`);
    url.searchParams.set("field", "sum(quantity)");
    url.searchParams.set("statsPeriod", statsPeriod);
    url.searchParams.set("interval", "1d");
    url.searchParams.set("category", "error");
    url.searchParams.set("project", "-1");
    const res = await fetch(url, { headers });
    if (!res.ok) return relayError(res, corsHeaders);
    return json({ stats: await res.json(), statsPeriod }, 200, corsHeaders);
  } catch (e) {
    const message = (e as Error).message ?? "Unknown error";
    console.error(`[sentry-report] ${action} threw: ${message}`);
    return json({ error: "Sentry request failed", details: message }, 502, corsHeaders);
  }
});
