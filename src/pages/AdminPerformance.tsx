/**
 * Performance diagnostics — Web Vitals, boot/navigation timing, API timing
 * breakdown and bundle budget, all measured on the device that opens this page.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, RefreshCw, Copy, Gauge } from "lucide-react";
import Header from "@/components/Layout/Header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getVitalsSnapshot } from "@/lib/perf/webVitals";
import { getRecentBridgeCalls, getBridgeCallTotal } from "@/lib/perf/bridgeMeter";

type Verdict = "good" | "warn" | "bad";

const VERDICT_VARIANT: Record<Verdict, "default" | "secondary" | "destructive"> = {
  good: "default",
  warn: "secondary",
  bad: "destructive",
};

function verdictFor(value: number | undefined, good: number, poor: number): Verdict {
  if (value == null) return "warn";
  if (value <= good) return "good";
  return value <= poor ? "warn" : "bad";
}

type ApiRow = { host: string; calls: number; p50: number; p95: number; max: number; bytes: number; failures: number };

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[i]);
}

/** Group `resource` timings by host — the API timing breakdown. */
function collectApiRows(): ApiRow[] {
  if (typeof performance === "undefined" || !performance.getEntriesByType) return [];
  const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const byHost = new Map<string, { durations: number[]; bytes: number; failures: number }>();
  for (const e of entries) {
    if (e.initiatorType !== "fetch" && e.initiatorType !== "xmlhttprequest") continue;
    let host: string;
    try { host = new URL(e.name).host; } catch { continue; }
    const bucket = byHost.get(host) ?? { durations: [], bytes: 0, failures: 0 };
    bucket.durations.push(e.duration);
    bucket.bytes += e.transferSize || 0;
    // A fetch that transferred nothing and returned instantly is usually a
    // failed/blocked request rather than a cache hit.
    if (e.transferSize === 0 && e.duration === 0) bucket.failures += 1;
    byHost.set(host, bucket);
  }
  return [...byHost.entries()]
    .map(([host, b]) => {
      const sorted = [...b.durations].sort((x, y) => x - y);
      return {
        host,
        calls: sorted.length,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        max: Math.round(sorted[sorted.length - 1] ?? 0),
        bytes: b.bytes,
        failures: b.failures,
      };
    })
    .sort((a, b) => b.p95 - a.p95);
}

type NavTiming = { ttfb?: number; domContentLoaded?: number; load?: number; fcp?: number };

function collectNavTiming(): NavTiming {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const fcp = performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint");
  return {
    ttfb: nav ? Math.round(nav.responseStart) : undefined,
    domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : undefined,
    load: nav && nav.loadEventEnd > 0 ? Math.round(nav.loadEventEnd) : undefined,
    fcp: fcp ? Math.round(fcp.startTime) : undefined,
  };
}

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

function Metric({ label, value, unit, verdict, hint }: {
  label: string; value: string; unit?: string; verdict: Verdict; hint: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Badge variant={VERDICT_VARIANT[verdict]} className="text-[10px]">{verdict}</Badge>
      </div>
      <p className="mt-1 text-lg font-semibold tabular-nums">
        {value}<span className="ml-0.5 text-xs font-normal text-muted-foreground">{unit}</span>
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

export default function AdminPerformance() {
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  const [heap, setHeap] = useState<number | null>(null);

  const vitals = useMemo(() => getVitalsSnapshot(), [tick]);
  const nav = useMemo(() => collectNavTiming(), [tick]);
  const apiRows = useMemo(() => collectApiRows(), [tick]);
  const bridge = useMemo(() => ({ recent: getRecentBridgeCalls(), total: getBridgeCallTotal() }), [tick]);

  useEffect(() => {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    setHeap(mem ? mem.usedJSHeapSize : null);
  }, [tick]);

  const bottlenecks = useMemo(() => {
    const out: string[] = [];
    if ((vitals.lcp ?? 0) > 2500) out.push(`LCP ${Math.round(vitals.lcp!)}ms — largest element paints too late.`);
    if ((vitals.inp ?? 0) > 200) out.push(`INP ${Math.round(vitals.inp!)}ms — input feels laggy.`);
    if ((vitals.cls ?? 0) > 0.1) out.push(`CLS ${vitals.cls!.toFixed(3)} — layout shifts after paint.`);
    if (vitals.longTasks > 10) out.push(`${vitals.longTasks} long tasks — main thread blocked repeatedly.`);
    apiRows.filter((r) => r.p95 > 800).forEach((r) => out.push(`${r.host} P95 ${r.p95}ms — slow API host.`));
    if (heap != null && heap > 250 * 1024 * 1024) out.push(`JS heap ${fmtBytes(heap)} — OOM risk on low-RAM Android.`);
    return out;
  }, [vitals, apiRows, heap]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const copy = useCallback(async () => {
    const body = [
      `Performance diagnostics — ${new Date().toISOString()}`,
      `LCP=${vitals.lcp ?? "n/a"} INP=${vitals.inp ?? "n/a"} CLS=${vitals.cls ?? "n/a"} longTasks=${vitals.longTasks}`,
      `TTFB=${nav.ttfb ?? "n/a"} FCP=${nav.fcp ?? "n/a"} DCL=${nav.domContentLoaded ?? "n/a"} load=${nav.load ?? "n/a"}`,
      `heap=${heap != null ? fmtBytes(heap) : "n/a"} bridgeCalls=${bridge.total}`,
      "",
      "API timing (host | calls | p50 | p95 | max | bytes):",
      ...apiRows.map((r) => `- ${r.host} | ${r.calls} | ${r.p50}ms | ${r.p95}ms | ${r.max}ms | ${fmtBytes(r.bytes)}`),
      "",
      "Bottlenecks:",
      ...(bottlenecks.length ? bottlenecks.map((b) => `- ${b}`) : ["- none detected"]),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(body);
      toast.success("Diagnostics copied");
    } catch {
      toast.error("Copy failed — take a screenshot instead");
    }
  }, [vitals, nav, heap, bridge.total, apiRows, bottlenecks]);

  return (
    <div className="min-h-screen bg-background">
      <Header onMenuClick={() => navigate("/admin")} />
      <main className="container mx-auto max-w-4xl px-4 py-6 space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} className="gap-2 -ml-1">
          <ArrowLeft className="h-4 w-4" /> Admin
        </Button>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2"><Gauge className="h-4 w-4" /> Performance diagnostics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Measured live on this device since the app booted. Open a lesson or PDF, then
              come back and refresh to see the effect.
            </p>

            <div className="flex flex-wrap gap-2">
              <Button onClick={refresh} className="gap-2"><RefreshCw className="h-4 w-4" /> Refresh</Button>
              <Button variant="outline" onClick={copy} className="gap-2"><Copy className="h-4 w-4" /> Copy report</Button>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="LCP" value={vitals.lcp != null ? String(Math.round(vitals.lcp)) : "—"} unit="ms"
                verdict={verdictFor(vitals.lcp, 2500, 4000)} hint="Target < 2500ms" />
              <Metric label="INP" value={vitals.inp != null ? String(Math.round(vitals.inp)) : "—"} unit="ms"
                verdict={verdictFor(vitals.inp, 200, 500)} hint="Target < 200ms" />
              <Metric label="CLS" value={vitals.cls != null ? vitals.cls.toFixed(3) : "—"}
                verdict={verdictFor(vitals.cls, 0.1, 0.25)} hint="Target < 0.1" />
              <Metric label="Long tasks" value={String(vitals.longTasks)}
                verdict={verdictFor(vitals.longTasks, 5, 15)} hint="Blocks > 50ms" />
              <Metric label="TTFB" value={nav.ttfb != null ? String(nav.ttfb) : "—"} unit="ms"
                verdict={verdictFor(nav.ttfb, 800, 1800)} hint="Server response" />
              <Metric label="FCP" value={nav.fcp != null ? String(nav.fcp) : "—"} unit="ms"
                verdict={verdictFor(nav.fcp, 1800, 3000)} hint="First paint" />
              <Metric label="JS heap" value={heap != null ? fmtBytes(heap) : "—"}
                verdict={heap == null ? "warn" : heap > 250e6 ? "bad" : heap > 150e6 ? "warn" : "good"}
                hint="Keep < 250 MB" />
              <Metric label="Bridge calls" value={String(bridge.total)}
                verdict={bridge.total > 400 ? "warn" : "good"} hint="Native plugin hops" />
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">Bottlenecks</h3>
              {bottlenecks.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                  None detected in this session — all metrics within budget.
                </p>
              ) : (
                <ul className="space-y-1">
                  {bottlenecks.map((b) => (
                    <li key={b} className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">{b}</li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">API timing breakdown</h3>
              {apiRows.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                  No API calls recorded yet in this session.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border/60">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="p-2 text-left font-medium">Host</th>
                        <th className="p-2 text-right font-medium">Calls</th>
                        <th className="p-2 text-right font-medium">P50</th>
                        <th className="p-2 text-right font-medium">P95</th>
                        <th className="p-2 text-right font-medium">Max</th>
                        <th className="p-2 text-right font-medium">Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {apiRows.map((r) => (
                        <tr key={r.host} className="border-t border-border/50">
                          <td className="p-2 break-all">{r.host}</td>
                          <td className="p-2 text-right tabular-nums">{r.calls}</td>
                          <td className="p-2 text-right tabular-nums">{r.p50}ms</td>
                          <td className={`p-2 text-right tabular-nums ${r.p95 > 800 ? "text-destructive font-medium" : ""}`}>{r.p95}ms</td>
                          <td className="p-2 text-right tabular-nums">{r.max}ms</td>
                          <td className="p-2 text-right tabular-nums">{fmtBytes(r.bytes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
