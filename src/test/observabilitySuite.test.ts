import { describe, it, expect, beforeEach } from "vitest";
import {
  categorize, prioritize, triageAll, summarize, suspectFile,
  buildMarkdownReport, buildReportHtml, type SentryIssue,
} from "@/lib/sentryTriage";
import {
  BANDWIDTH_DEFAULTS, canDownload, getBandwidthPrefs, normalizePrefs,
  recordDownload, resetBandwidthPrefs, resetBandwidthStats, setBandwidthPrefs,
  shouldPrefetch, maxDownloadBytes, fmtBandwidth,
} from "@/lib/bandwidthGuard";

const issue = (over: Partial<SentryIssue> = {}): SentryIssue => ({
  id: "1",
  shortId: "PROJ-1",
  title: "Something broke",
  count: "1",
  userCount: 1,
  ...over,
});

describe("sentryTriage — categorize", () => {
  it("flags permission errors as SEC", () => {
    expect(categorize(issue({ title: "permission denied for table lessons" })).category).toBe("SEC");
  });
  it("flags 401/403 as AUTHZ", () => {
    expect(categorize(issue({ title: "Edge function returned 403: Unauthorized" })).category).toBe("AUTHZ");
  });
  it("flags stale chunk loads as CONFIG", () => {
    expect(categorize(issue({ title: "ChunkLoadError: Loading chunk 42 failed" })).category).toBe("CONFIG");
  });
  it("flags fetch failures as RELY", () => {
    expect(categorize(issue({ title: "TypeError: Failed to fetch" })).category).toBe("RELY");
  });
  it("falls back to MAINT when nothing matches", () => {
    expect(categorize(issue({ title: "zzz unknown thing" })).category).toBe("MAINT");
  });
});

describe("sentryTriage — prioritize", () => {
  it("puts repeated security issues at P0", () => {
    expect(prioritize("SEC", 9, 4)).toBe("P0");
  });
  it("keeps a one-off security issue at P1", () => {
    expect(prioritize("SEC", 1, 1)).toBe("P1");
  });
  it("treats fatal level as P0", () => {
    expect(prioritize("UX", 1, 1, "fatal")).toBe("P0");
  });
  it("parks observability noise at P3", () => {
    expect(prioritize("OBS", 99, 40)).toBe("P3");
  });
});

describe("sentryTriage — suspectFile", () => {
  it("extracts a src path from the culprit", () => {
    expect(suspectFile(issue({ culprit: "at load(src/hooks/useThing.ts:12)" }))).toBe("src/hooks/useThing.ts");
  });
  it("returns null when there is nothing to point at", () => {
    expect(suspectFile(issue({ culprit: null }))).toBeNull();
  });
});

describe("sentryTriage — summarize + report", () => {
  const rows = triageAll(
    [
      issue({ id: "a", title: "permission denied for table x", count: "12", userCount: 5 }),
      issue({ id: "b", title: "TypeError: Failed to fetch", count: "3", userCount: 1 }),
      issue({ id: "c", title: "unhandledrejection {}", count: "40", userCount: 9 }),
    ],
    0,
  );

  it("sorts P0 first", () => {
    expect(rows[0].priority).toBe("P0");
    expect(rows[0].issue.id).toBe("a");
  });

  it("drops the rating to 2 when a P0 exists", () => {
    const s = summarize(rows);
    expect(s.byPriority.P0).toBe(1);
    expect(s.rating).toBe(2);
    expect(s.verdict).toMatch(/blocker/i);
  });

  it("reports a clean window as 5/5", () => {
    const s = summarize([]);
    expect(s.rating).toBe(5);
    expect(s.total).toBe(0);
  });

  it("renders markdown containing every issue and the fix plan", () => {
    const s = summarize(rows);
    const md = buildMarkdownReport(rows, s, {
      org: "naveen-bharat",
      project: "app",
      period: "7d",
      generatedAt: new Date("2026-08-23T00:00:00Z"),
    });
    expect(md).toContain("# Weekly Sentry Triage — app — 2026-08-23");
    expect(md).toContain("Rating 2/5".replace("Rating ", "**Rating: "));
    expect(md).toContain("permission denied");
    expect(md).toContain("## Fix plan");
    expect(md).toContain("### P0");
  });

  it("converts markdown tables to HTML for the PDF export", () => {
    const s = summarize(rows);
    const md = buildMarkdownReport(rows, s, {
      org: "o", project: "p", period: "7d", generatedAt: new Date(),
    });
    const html = buildReportHtml(md, "T");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Priority</th>");
    expect(html).not.toContain("| --- |");
  });
});

describe("bandwidthGuard", () => {
  beforeEach(() => {
    localStorage.clear();
    resetBandwidthPrefs();
    resetBandwidthStats();
  });

  it("starts from the documented defaults", () => {
    expect(getBandwidthPrefs()).toEqual(BANDWIDTH_DEFAULTS);
  });

  it("clamps out-of-range values instead of trusting them", () => {
    expect(normalizePrefs({ perFileMb: 999999 }).perFileMb).toBe(2048);
    expect(normalizePrefs({ sessionBudgetMb: -5 }).sessionBudgetMb).toBe(50);
    expect(normalizePrefs({ videoQualityCap: "4k" }).videoQualityCap).toBe("auto");
  });

  it("persists a patch and reflects it in maxDownloadBytes", () => {
    setBandwidthPrefs({ perFileMb: 10 });
    expect(getBandwidthPrefs().perFileMb).toBe(10);
    expect(maxDownloadBytes()).toBe(10 * 1024 * 1024);
  });

  it("blocks a file over the per-file cap", () => {
    setBandwidthPrefs({ perFileMb: 10 });
    const d = canDownload(20 * 1024 * 1024);
    expect(d.allowed).toBe(false);
  });

  it("blocks once the session budget is exhausted", () => {
    setBandwidthPrefs({ perFileMb: 500, sessionBudgetMb: 50 });
    recordDownload(40 * 1024 * 1024);
    expect(canDownload(20 * 1024 * 1024).allowed).toBe(false);
    expect(canDownload(5 * 1024 * 1024).allowed).toBe(true);
  });

  it("allows unknown-size downloads while budget remains", () => {
    expect(canDownload(null).allowed).toBe(true);
  });

  it("honours the prefetch toggle", () => {
    expect(shouldPrefetch()).toBe(true);
    setBandwidthPrefs({ prefetchEnabled: false });
    expect(shouldPrefetch()).toBe(false);
  });

  it("formats byte counts for humans", () => {
    expect(fmtBandwidth(512)).toBe("512 B");
    expect(fmtBandwidth(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
