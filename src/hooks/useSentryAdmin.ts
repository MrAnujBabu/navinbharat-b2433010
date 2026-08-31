/**
 * Thin client for the `sentry-report` edge function. Keeps every network
 * concern (auth header, error shape, loading flags) out of the pages.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { triageAll, summarize, type SentryIssue, type TriagedIssue, type TriageSummary } from "@/lib/sentryTriage";

export type StatsPeriod = "24h" | "7d" | "14d" | "30d";

type InvokeBody = Record<string, unknown>;

async function callSentry<T>(body: InvokeBody): Promise<T> {
  const { data, error } = await supabase.functions.invoke("sentry-report", { body });
  if (error) {
    // supabase-js hides the JSON body on non-2xx; surface whatever we can.
    const detail = (data as { error?: string; details?: string } | null);
    throw new Error(detail?.details || detail?.error || error.message || "Sentry request failed");
  }
  const payload = data as (T & { error?: string; details?: string }) | null;
  if (payload && payload.error) throw new Error(payload.details || payload.error);
  if (!payload) throw new Error("Empty response from sentry-report");
  return payload as T;
}

const PERIOD_MS: Record<StatsPeriod, number> = {
  "24h": 24 * 3600e3,
  "7d": 7 * 24 * 3600e3,
  "14d": 14 * 24 * 3600e3,
  "30d": 30 * 24 * 3600e3,
};

export function useSentryAdmin(initialPeriod: StatsPeriod = "7d") {
  const [period, setPeriod] = useState<StatsPeriod>(initialPeriod);
  const [query, setQuery] = useState("is:unresolved");
  const [rows, setRows] = useState<TriagedIssue[]>([]);
  const [summary, setSummary] = useState<TriageSummary | null>(null);
  const [meta, setMeta] = useState<{ org: string; project: string } | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  const load = useCallback(
    async (opts?: { period?: StatsPeriod; query?: string }) => {
      const p = opts?.period ?? period;
      const q = opts?.query ?? query;
      setLoading(true);
      setError(null);
      try {
        const res = await callSentry<{ issues: SentryIssue[]; org: string; project: string }>({
          action: "issues",
          statsPeriod: p,
          query: q,
          limit: 100,
        });
        const windowStart = Date.now() - PERIOD_MS[p];
        const triaged = triageAll(res.issues ?? [], windowStart);
        setRows(triaged);
        setSummary(summarize(triaged));
        setMeta({ org: res.org, project: res.project });
        setConfigured(true);
        setLastLoadedAt(new Date());
      } catch (e) {
        setError((e as Error).message);
        setRows([]);
        setSummary(null);
      } finally {
        setLoading(false);
      }
    },
    [period, query],
  );

  const updateStatus = useCallback(
    async (issueId: string, status: "resolved" | "ignored" | "unresolved") => {
      await callSentry({ action: "update_issue", issueId, status });
      setRows((prev) => prev.filter((r) => r.issue.id !== issueId));
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    callSentry<{ configured: boolean }>({ action: "config" })
      .then((c) => { if (alive) setConfigured(c.configured); })
      .catch((e) => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, []);

  return {
    period, setPeriod, query, setQuery,
    rows, summary, meta, configured,
    loading, error, lastLoadedAt,
    load, updateStatus,
  };
}
