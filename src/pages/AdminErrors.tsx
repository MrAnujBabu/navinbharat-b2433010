/**
 * Errors & Incidents — live Sentry issue list with triage, plus the weekly
 * report generator (Markdown + PDF export).
 */
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, RefreshCw, FileText, FileDown, CheckCircle2, BellOff, ExternalLink, AlertTriangle,
} from "lucide-react";
import Header from "@/components/Layout/Header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useSentryAdmin, type StatsPeriod } from "@/hooks/useSentryAdmin";
import {
  buildMarkdownReport, buildReportHtml, PRIORITY_ORDER,
  type Priority, type TriagedIssue,
} from "@/lib/sentryTriage";
import { downloadMarkdown, downloadPdfFromHtml } from "@/lib/reportExport";

const PRIORITY_VARIANT: Record<Priority, "default" | "secondary" | "destructive" | "outline"> = {
  P0: "destructive",
  P1: "default",
  P2: "secondary",
  P3: "outline",
};

const QUERIES = [
  { value: "is:unresolved", label: "Unresolved" },
  { value: "is:unresolved is:unassigned", label: "Unresolved · unassigned" },
  { value: "is:unresolved level:error", label: "Errors only" },
  { value: "is:resolved", label: "Resolved" },
  { value: "is:ignored", label: "Ignored" },
];

function IssueRow({
  row, onResolve, onIgnore, busy,
}: {
  row: TriagedIssue;
  onResolve: () => void;
  onIgnore: () => void;
  busy: boolean;
}) {
  const { issue } = row;
  return (
    <div className="rounded-xl border border-border/60 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <Badge variant={PRIORITY_VARIANT[row.priority]} className="shrink-0">{row.priority}</Badge>
        <Badge variant="outline" className="shrink-0">{row.category}</Badge>
        {row.isNew && <Badge variant="secondary" className="shrink-0">New</Badge>}
        <p className="text-sm font-medium leading-snug break-words">{issue.title}</p>
      </div>
      <p className="text-xs text-muted-foreground break-words">{row.rationale}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
        <span>{row.events} events</span>
        <span>{row.users} users</span>
        <span>{issue.shortId ?? issue.id}</span>
        {row.suspectFile && <code className="rounded bg-muted px-1 py-0.5">{row.suspectFile}</code>}
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={onResolve} disabled={busy}>
          <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
        </Button>
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={onIgnore} disabled={busy}>
          <BellOff className="h-3.5 w-3.5" /> Ignore
        </Button>
        {issue.permalink && (
          <Button size="sm" variant="ghost" className="gap-1.5" asChild>
            <a href={issue.permalink} target="_blank" rel="noreferrer noopener">
              <ExternalLink className="h-3.5 w-3.5" /> Sentry
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

export default function AdminErrors() {
  const navigate = useNavigate();
  const {
    period, setPeriod, query, setQuery, rows, summary, meta, configured,
    loading, error, lastLoadedAt, load, updateStatus,
  } = useSentryAdmin("7d");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Priority>("all");
  const [exporting, setExporting] = useState(false);

  const filtered = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.priority === filter)),
    [rows, filter],
  );

  const markdown = useMemo(() => {
    if (!summary) return "";
    return buildMarkdownReport(rows, summary, {
      org: meta?.org ?? "unknown",
      project: meta?.project ?? "unknown",
      period,
      generatedAt: new Date(),
    });
  }, [rows, summary, meta, period]);

  const act = useCallback(
    async (id: string, status: "resolved" | "ignored") => {
      setBusyId(id);
      try {
        await updateStatus(id, status);
        toast.success(status === "resolved" ? "Issue resolved" : "Issue ignored");
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusyId(null);
      }
    },
    [updateStatus],
  );

  const stamp = new Date().toISOString().slice(0, 10);

  const exportMarkdown = () => {
    if (!markdown) return;
    downloadMarkdown(markdown, `sentry-triage-${stamp}.md`);
    toast.success("Markdown report downloaded");
  };

  const exportPdf = async () => {
    if (!markdown) return;
    setExporting(true);
    try {
      await downloadPdfFromHtml(
        buildReportHtml(markdown, `Sentry Triage ${stamp}`),
        `sentry-triage-${stamp}.pdf`,
      );
      toast.success("PDF report downloaded");
    } catch (e) {
      toast.error(`PDF export failed — ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header onMenuClick={() => navigate("/admin")} />
      <main className="container mx-auto max-w-4xl px-4 py-6 space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} className="gap-2 -ml-1">
          <ArrowLeft className="h-4 w-4" /> Admin
        </Button>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Errors &amp; Incidents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Live Sentry issues, auto-categorised and prioritised. Generate the weekly
              triage report and export it as Markdown or PDF.
            </p>

            {configured === false && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
                <span>
                  Sentry is not configured. Set <code>SENTRY_AUTH_TOKEN</code>,{" "}
                  <code>SENTRY_ORG_SLUG</code> and <code>SENTRY_PROJECT_SLUG</code> in backend secrets.
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Select value={period} onValueChange={(v) => setPeriod(v as StatsPeriod)}>
                <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">Last 24h</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="14d">Last 14 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                </SelectContent>
              </Select>
              <Select value={query} onValueChange={setQuery}>
                <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {QUERIES.map((q) => (
                    <SelectItem key={q.value} value={q.value}>{q.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={() => load()} disabled={loading} className="gap-2">
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                {loading ? "Loading…" : "Load issues"}
              </Button>
              <Button variant="outline" onClick={exportMarkdown} disabled={!markdown} className="gap-2">
                <FileText className="h-4 w-4" /> Markdown
              </Button>
              <Button variant="outline" onClick={exportPdf} disabled={!markdown || exporting} className="gap-2">
                <FileDown className="h-4 w-4" /> {exporting ? "Building…" : "PDF"}
              </Button>
            </div>

            {error && <p className="text-sm text-destructive break-words">{error}</p>}

            {summary && (
              <div className="space-y-3">
                <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
                  <p className="text-sm font-semibold">Rating {summary.rating}/5 — {summary.verdict}</p>
                  <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                    {summary.total} issues · {summary.events} events · {summary.users} users affected ·{" "}
                    {summary.newIssues} new
                    {lastLoadedAt ? ` · loaded ${lastLoadedAt.toLocaleTimeString()}` : ""}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={filter === "all" ? "default" : "outline"}
                    onClick={() => setFilter("all")}
                  >
                    All {rows.length}
                  </Button>
                  {PRIORITY_ORDER.map((p) => (
                    <Button
                      key={p}
                      size="sm"
                      variant={filter === p ? "default" : "outline"}
                      onClick={() => setFilter(p)}
                    >
                      {p} {summary.byPriority[p]}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              {filtered.map((row) => (
                <IssueRow
                  key={row.issue.id}
                  row={row}
                  busy={busyId === row.issue.id}
                  onResolve={() => act(row.issue.id, "resolved")}
                  onIgnore={() => act(row.issue.id, "ignored")}
                />
              ))}
              {!loading && summary && filtered.length === 0 && (
                <div className="rounded-xl border border-dashed border-border p-6 text-center">
                  <p className="text-sm font-medium">Nothing here</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    No issues match this filter in the selected window.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
