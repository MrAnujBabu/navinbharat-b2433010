/**
 * Sentry triage engine — the logic half of the Errors & Incidents page and of
 * the weekly report. Pure functions only (no network, no DOM) so the whole
 * classification rubric is unit-testable.
 *
 * Categories follow the senior-architect-audit lens; severity follows the
 * sentry-triage skill's severity x volume rule.
 */

export type SentryIssue = {
  id: string;
  shortId?: string;
  title: string;
  culprit?: string | null;
  level?: string;
  status?: string;
  count?: string | number;
  userCount?: number;
  firstSeen?: string;
  lastSeen?: string;
  permalink?: string;
  metadata?: { type?: string; value?: string; filename?: string } | null;
};

export type TriageCategory =
  | "SEC"
  | "AUTHZ"
  | "DATA"
  | "PERF"
  | "RELY"
  | "UX"
  | "A11Y"
  | "OBS"
  | "MAINT"
  | "CONFIG";

export type Priority = "P0" | "P1" | "P2" | "P3";

export type TriagedIssue = {
  issue: SentryIssue;
  events: number;
  users: number;
  category: TriageCategory;
  priority: Priority;
  rationale: string;
  suspectFile: string | null;
  isNew: boolean;
};

const RULES: Array<{ re: RegExp; category: TriageCategory; rationale: string }> = [
  { re: /permission denied|42501|row-level security|rls/i, category: "SEC", rationale: "Database refused the operation — missing GRANT or RLS policy." },
  { re: /unauthorized|forbidden|401|403|jwt|invalid token|not authorized/i, category: "AUTHZ", rationale: "Auth or role gate rejected the request." },
  { re: /400|schema|column .* does not exist|violates|constraint|pgrst|invalid input|parse/i, category: "DATA", rationale: "Payload or schema mismatch between client and backend." },
  { re: /timeout|timed out|slow|deadline|long task/i, category: "PERF", rationale: "Operation exceeded its time budget." },
  { re: /failed to fetch|network|networkerror|load failed|5\d\d|aborted|econn|offline/i, category: "RELY", rationale: "Transient network or upstream failure." },
  { re: /chunkloaderror|loading chunk|dynamically imported module/i, category: "CONFIG", rationale: "Stale deploy — client asked for a chunk the new build no longer serves." },
  { re: /invalidpdf|dataclone|pdf|render|hydrat|is not a function|undefined is not|cannot read propert/i, category: "UX", rationale: "Client-side render or data-shape bug on a user-visible surface." },
  { re: /unhandledrejection|non-error|empty|\{\}/i, category: "OBS", rationale: "Report lacks a payload — instrumentation gap, not necessarily a user bug." },
  { re: /aria|focus|contrast/i, category: "A11Y", rationale: "Accessibility affordance failed." },
];

export function categorize(issue: SentryIssue): { category: TriageCategory; rationale: string } {
  const hay = [issue.title, issue.culprit ?? "", issue.metadata?.value ?? "", issue.metadata?.type ?? ""].join(" ");
  for (const rule of RULES) {
    if (rule.re.test(hay)) return { category: rule.category, rationale: rule.rationale };
  }
  return { category: "MAINT", rationale: "Unclassified — needs a manual read of the stack trace." };
}

const num = (v: string | number | undefined) => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** P0 = security/data with real volume; P3 = low-volume observability noise. */
export function prioritize(category: TriageCategory, events: number, users: number, level?: string): Priority {
  if (category === "SEC" || category === "AUTHZ") return events >= 3 || users >= 2 ? "P0" : "P1";
  if (category === "DATA") return events >= 5 ? "P0" : "P1";
  if (level === "fatal") return "P0";
  if (category === "RELY" || category === "UX" || category === "CONFIG") {
    return events > 5 || users > 1 ? "P1" : "P2";
  }
  if (category === "PERF") return events > 10 ? "P1" : "P2";
  if (category === "OBS") return "P3";
  return events > 10 ? "P1" : "P2";
}

/** Best-effort `src/...` pointer from culprit or metadata — never fabricated. */
export function suspectFile(issue: SentryIssue): string | null {
  const candidates = [issue.culprit ?? "", issue.metadata?.filename ?? ""];
  for (const c of candidates) {
    const m = c.match(/((?:src|supabase)\/[\w./-]+)/);
    if (m) return m[1];
    if (c && !/^https?:/.test(c)) return c.slice(0, 120);
  }
  return null;
}

export function triage(issue: SentryIssue, windowStart = 0): TriagedIssue {
  const { category, rationale } = categorize(issue);
  const events = num(issue.count);
  const users = num(issue.userCount);
  const firstSeen = issue.firstSeen ? Date.parse(issue.firstSeen) : NaN;
  return {
    issue,
    events,
    users,
    category,
    rationale,
    suspectFile: suspectFile(issue),
    priority: prioritize(category, events, users, issue.level),
    isNew: Number.isFinite(firstSeen) && firstSeen >= windowStart,
  };
}

export const PRIORITY_ORDER: Priority[] = ["P0", "P1", "P2", "P3"];

export function triageAll(issues: SentryIssue[], windowStart = 0): TriagedIssue[] {
  return issues
    .map((i) => triage(i, windowStart))
    .sort(
      (a, b) =>
        PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) ||
        b.events - a.events,
    );
}

export type TriageSummary = {
  total: number;
  events: number;
  users: number;
  byPriority: Record<Priority, number>;
  byCategory: Partial<Record<TriageCategory, number>>;
  newIssues: number;
  /** 1–5, the senior-architect-audit style health score. */
  rating: number;
  verdict: string;
};

export function summarize(rows: TriagedIssue[]): TriageSummary {
  const byPriority: Record<Priority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  const byCategory: Partial<Record<TriageCategory, number>> = {};
  let events = 0;
  let users = 0;
  let newIssues = 0;
  for (const r of rows) {
    byPriority[r.priority] += 1;
    byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    events += r.events;
    users += r.users;
    if (r.isNew) newIssues += 1;
  }
  let rating = 5;
  if (byPriority.P0 > 0) rating = 2;
  else if (byPriority.P1 >= 3) rating = 3;
  else if (byPriority.P1 > 0) rating = 4;
  else if (byPriority.P2 > 3) rating = 4;
  const verdict =
    byPriority.P0 > 0
      ? "Ship blocker — P0 issues are open."
      : byPriority.P1 > 0
        ? "Healthy but needs attention this sprint."
        : rows.length === 0
          ? "Clean window — no unresolved issues."
          : "Stable — only low-priority noise remains.";
  return { total: rows.length, events, users, byPriority, byCategory, newIssues, rating, verdict };
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function buildMarkdownReport(
  rows: TriagedIssue[],
  summary: TriageSummary,
  meta: { org: string; project: string; period: string; generatedAt: Date },
): string {
  const date = meta.generatedAt.toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`# Weekly Sentry Triage — ${meta.project} — ${date}`);
  lines.push("");
  lines.push(`**Rating: ${summary.rating}/5** — ${summary.verdict}`);
  lines.push("");
  lines.push(
    `Window: last ${meta.period} · Org: \`${meta.org}\` · Unresolved issues: ${summary.total} · Events: ${summary.events} · Users affected: ${summary.users} · New this window: ${summary.newIssues}`,
  );
  lines.push("");
  lines.push("## Priority mix");
  lines.push("");
  lines.push("| Priority | Issues |");
  lines.push("| --- | --- |");
  PRIORITY_ORDER.forEach((p) => lines.push(`| ${p} | ${summary.byPriority[p]} |`));
  lines.push("");
  lines.push("## Category mix");
  lines.push("");
  lines.push("| Category | Issues |");
  lines.push("| --- | --- |");
  Object.entries(summary.byCategory)
    .sort((a, b) => b[1] - a[1])
    .forEach(([c, n]) => lines.push(`| ${c} | ${n} |`));
  lines.push("");
  lines.push("## Issues");
  lines.push("");
  lines.push("| # | Issue | Short ID | Events | Users | Category | Priority | Suspect | New |");
  lines.push("| - | ----- | -------- | ------ | ----- | -------- | -------- | ------- | --- |");
  rows.forEach((r, i) => {
    lines.push(
      `| ${i + 1} | ${esc(r.issue.title).slice(0, 90)} | ${r.issue.shortId ?? r.issue.id} | ${r.events} | ${r.users} | ${r.category} | ${r.priority} | ${r.suspectFile ? `\`${esc(r.suspectFile)}\`` : "UNMAPPED"} | ${r.isNew ? "yes" : "no"} |`,
    );
  });
  if (rows.length === 0) lines.push("| — | No unresolved issues in this window | | | | | | | |");
  lines.push("");
  lines.push("## Fix plan");
  lines.push("");
  PRIORITY_ORDER.forEach((p) => {
    const group = rows.filter((r) => r.priority === p);
    if (group.length === 0) return;
    lines.push(`### ${p}`);
    lines.push("");
    group.forEach((r) => {
      lines.push(
        `- **${esc(r.issue.title).slice(0, 100)}** (${r.events} events) — ${r.rationale} Owner: ${r.suspectFile ? `\`${r.suspectFile}\`` : "UNMAPPED — read the latest event stack"}.`,
      );
    });
    lines.push("");
  });
  lines.push("## Notes");
  lines.push("");
  lines.push("- Generated automatically from the Sentry Web API via the `sentry-report` edge function.");
  lines.push("- Priorities follow severity x event volume; SEC/AUTHZ findings are never auto-resolved.");
  lines.push("");
  return lines.join("\n");
}

/** Minimal, print-friendly HTML used for the PDF export. */
export function buildReportHtml(markdown: string, title: string): string {
  const rowsToHtml = (block: string[]) => {
    const cells = (line: string) =>
      line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    const head = cells(block[0]);
    const body = block.slice(2).map(cells);
    return `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body
      .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
      .join("")}</tbody></table>`;
  };

  const out: string[] = [];
  const lines = markdown.split("\n");
  let table: string[] = [];
  const flush = () => {
    if (table.length >= 2) out.push(rowsToHtml(table));
    table = [];
  };
  const inline = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`(.+?)`/g, "<code>$1</code>");

  for (const line of lines) {
    if (line.trim().startsWith("|")) { table.push(line); continue; }
    flush();
    if (line.startsWith("### ")) out.push(`<h3>${inline(line.slice(4))}</h3>`);
    else if (line.startsWith("## ")) out.push(`<h2>${inline(line.slice(3))}</h2>`);
    else if (line.startsWith("# ")) out.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (line.startsWith("- ")) out.push(`<p class="li">• ${inline(line.slice(2))}</p>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  flush();

  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#111;padding:28px;font-size:12px;line-height:1.5}
  h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:20px 0 6px;border-bottom:1px solid #e5e7eb;padding-bottom:4px}
  h3{font-size:13px;margin:14px 0 4px}p{margin:4px 0}.li{margin-left:10px}
  table{border-collapse:collapse;width:100%;margin:8px 0;font-size:10.5px}
  th,td{border:1px solid #e5e7eb;padding:4px 6px;text-align:left;vertical-align:top}
  th{background:#f8fafc;font-weight:600}
  code{background:#f1f5f9;padding:1px 3px;border-radius:3px;font-size:10px}
</style></head><body>${out.join("")}</body></html>`;
}
