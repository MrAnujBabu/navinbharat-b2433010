/**
 * Bandwidth guard settings — tune download caps and read live download health.
 *
 * Prefs are device-local (localStorage) on purpose: the guard exists to protect
 * *this* phone's data plan and memory, so it must work offline and must not
 * need a round trip before a download decision.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, RotateCcw, Wifi, Copy } from "lucide-react";
import Header from "@/components/Layout/Header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  BANDWIDTH_LIMITS, fmtBandwidth, getBandwidthPrefs, getBandwidthStats,
  isConstrainedNetwork, resetBandwidthPrefs, resetBandwidthStats, setBandwidthPrefs,
  type BandwidthPrefs,
} from "@/lib/bandwidthGuard";

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" | "warn" }) {
  return (
    <div className="rounded-xl border border-border/60 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${
        tone === "bad" ? "text-destructive" : tone === "warn" ? "text-amber-600 dark:text-amber-500" : ""
      }`}>{value}</p>
    </div>
  );
}

export default function AdminBandwidth() {
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState<BandwidthPrefs>(() => getBandwidthPrefs());
  const [stats, setStats] = useState(() => ({ ...getBandwidthStats() }));
  const [constrained, setConstrained] = useState(false);

  useEffect(() => {
    const tick = () => {
      setStats({ ...getBandwidthStats() });
      setConstrained(isConstrainedNetwork());
    };
    tick();
    const id = window.setInterval(tick, 3000);
    return () => window.clearInterval(id);
  }, []);

  const patch = useCallback((p: Partial<BandwidthPrefs>) => {
    setPrefs(setBandwidthPrefs(p));
  }, []);

  const reset = useCallback(() => {
    setPrefs(resetBandwidthPrefs());
    toast.success("Defaults restored");
  }, []);

  const budgetUsedPct = Math.min(
    100,
    Math.round((stats.downloadedBytes / (prefs.sessionBudgetMb * 1024 * 1024)) * 100),
  );
  const successRate = stats.downloads === 0
    ? 100
    : Math.round(((stats.downloads - stats.failures) / stats.downloads) * 100);

  const copy = useCallback(async () => {
    const body = [
      `Bandwidth health — ${new Date().toISOString()}`,
      `perFile=${prefs.perFileMb}MB sessionBudget=${prefs.sessionBudgetMb}MB prefetch=${prefs.prefetchEnabled} dataSaver=${prefs.dataSaver} videoCap=${prefs.videoQualityCap}`,
      `downloaded=${fmtBandwidth(stats.downloadedBytes)} (${budgetUsedPct}% of budget) downloads=${stats.downloads} cacheHits=${stats.cacheHits} failures=${stats.failures} retries=${stats.retries} blocked=${stats.blocked}`,
      `constrainedNetwork=${constrained}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(body);
      toast.success("Health metrics copied");
    } catch {
      toast.error("Copy failed");
    }
  }, [prefs, stats, budgetUsedPct, constrained]);

  return (
    <div className="min-h-screen bg-background">
      <Header onMenuClick={() => navigate("/admin")} />
      <main className="container mx-auto max-w-3xl px-4 py-6 space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} className="gap-2 -ml-1">
          <ArrowLeft className="h-4 w-4" /> Admin
        </Button>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2"><Wifi className="h-4 w-4" /> Bandwidth guard</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Caps how much data the app may pull on this device. Applies to link imports,
              PDF downloads and idle route prefetching.
            </p>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Downloaded" value={fmtBandwidth(stats.downloadedBytes)} />
              <Stat
                label="Budget used"
                value={`${budgetUsedPct}%`}
                tone={budgetUsedPct > 90 ? "bad" : budgetUsedPct > 70 ? "warn" : undefined}
              />
              <Stat
                label="Success rate"
                value={`${successRate}%`}
                tone={successRate < 80 ? "bad" : successRate < 95 ? "warn" : undefined}
              />
              <Stat label="Blocked by cap" value={String(stats.blocked)} tone={stats.blocked > 0 ? "warn" : undefined} />
              <Stat label="Downloads" value={String(stats.downloads)} />
              <Stat label="Cache hits" value={String(stats.cacheHits)} />
              <Stat label="Failures" value={String(stats.failures)} tone={stats.failures > 0 ? "warn" : undefined} />
              <Stat label="Retries" value={String(stats.retries)} />
            </div>

            {constrained && (
              <Badge variant="secondary">Constrained network detected — data saver rules apply</Badge>
            )}

            <Separator />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="perfile">Per-file limit</Label>
                <span className="text-sm font-medium tabular-nums">{prefs.perFileMb} MB</span>
              </div>
              <Slider
                id="perfile"
                min={BANDWIDTH_LIMITS.perFileMb.min}
                max={BANDWIDTH_LIMITS.perFileMb.max}
                step={5}
                value={[prefs.perFileMb]}
                onValueChange={([v]) => patch({ perFileMb: v })}
              />
              <p className="text-xs text-muted-foreground">
                A single PDF or link import larger than this is rejected before download starts.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="session">Session download budget</Label>
                <span className="text-sm font-medium tabular-nums">{prefs.sessionBudgetMb} MB</span>
              </div>
              <Slider
                id="session"
                min={BANDWIDTH_LIMITS.sessionBudgetMb.min}
                max={BANDWIDTH_LIMITS.sessionBudgetMb.max}
                step={50}
                value={[prefs.sessionBudgetMb]}
                onValueChange={([v]) => patch({ sessionBudgetMb: v })}
              />
              <p className="text-xs text-muted-foreground">
                Total bytes this app session may download. Resets when the app restarts.
              </p>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="prefetch">Idle prefetch</Label>
                <p className="text-xs text-muted-foreground">Warm lesson screens in the background for instant taps.</p>
              </div>
              <Switch
                id="prefetch"
                checked={prefs.prefetchEnabled}
                onCheckedChange={(v) => patch({ prefetchEnabled: v })}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="datasaver">Data saver</Label>
                <p className="text-xs text-muted-foreground">Skip prefetch and lower video quality on slow/metered networks.</p>
              </div>
              <Switch
                id="datasaver"
                checked={prefs.dataSaver}
                onCheckedChange={(v) => patch({ dataSaver: v })}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label>Video quality cap</Label>
                <p className="text-xs text-muted-foreground">Highest rung the player may request.</p>
              </div>
              <Select
                value={prefs.videoQualityCap}
                onValueChange={(v) => patch({ videoQualityCap: v as BandwidthPrefs["videoQualityCap"] })}
              >
                <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="1080p">1080p</SelectItem>
                  <SelectItem value="720p">720p</SelectItem>
                  <SelectItem value="480p">480p</SelectItem>
                  <SelectItem value="360p">360p</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={reset} className="gap-2">
                <RotateCcw className="h-4 w-4" /> Restore defaults
              </Button>
              <Button
                variant="ghost"
                onClick={() => { resetBandwidthStats(); setStats({ ...getBandwidthStats() }); toast.success("Counters reset"); }}
              >
                Reset counters
              </Button>
              <Button variant="ghost" onClick={copy} className="gap-2">
                <Copy className="h-4 w-4" /> Copy metrics
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
