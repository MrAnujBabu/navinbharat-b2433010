import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Copy, Play } from "lucide-react";
import Header from "@/components/Layout/Header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

interface HealthResult {
  ready: boolean;
  mode: "live" | "test" | "unknown" | "missing";
  keyIdPresent: boolean;
  keyIdPrefix: string | null;
  keySecretPresent: boolean;
  webhookSecretPresent: boolean;
  authenticates: boolean;
  upstreamStatus?: number;
  ms?: number;
  hint?: string;
  upstreamError?: string;
}

/**
 * Admin-only Razorpay configuration probe (payments-health). Shows whether the
 * project is running on test or live credentials, whether those credentials
 * actually authenticate against Razorpay, and whether the webhook secret is
 * set. Never reveals a secret — only a key-id prefix.
 */
export default function AdminPaymentsHealth() {
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<HealthResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Session expire ho gaya — dobara login karein.");
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/payments-health`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json as { error?: string })?.error || `HTTP ${res.status}`);
      setResult(json as HealthResult);
    } catch (e) {
      setError((e as Error).message);
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  }, []);

  const copy = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      toast.success("Report copied");
    } catch {
      toast.error("Copy nahi hua — screenshot le lo.");
    }
  }, [result]);

  return (
    <div className="min-h-screen bg-background">
      <Header onMenuClick={() => navigate("/admin")} />
      <main className="container mx-auto max-w-3xl px-4 py-6 space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Admin
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Payments Health (Razorpay)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Test se live key switch karne ke baad yahan check karo: mode live hona
              chahiye, authenticates true, aur webhook secret present.
            </p>

            <div className="flex flex-wrap gap-2">
              <Button onClick={run} disabled={running} className="gap-2">
                <Play className="h-4 w-4" />
                {running ? "Check ho raha hai…" : "Run check"}
              </Button>
              {result && (
                <Button variant="outline" onClick={copy} className="gap-2">
                  <Copy className="h-4 w-4" /> Copy report
                </Button>
              )}
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            {result && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={result.mode === "live" ? "default" : "secondary"}>
                    mode: {result.mode}
                  </Badge>
                  <Badge variant={result.authenticates ? "default" : "destructive"}>
                    authenticates: {String(result.authenticates)}
                  </Badge>
                  <Badge variant={result.webhookSecretPresent ? "default" : "destructive"}>
                    webhook secret: {result.webhookSecretPresent ? "set" : "missing"}
                  </Badge>
                  <Badge variant={result.ready ? "default" : "destructive"}>
                    {result.ready ? "ready" : "not ready"}
                  </Badge>
                </div>

                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-muted-foreground">Key id</dt>
                  <dd className="font-mono">{result.keyIdPrefix || "—"}</dd>
                  <dt className="text-muted-foreground">Key secret</dt>
                  <dd>{result.keySecretPresent ? "set" : "missing"}</dd>
                  <dt className="text-muted-foreground">Razorpay status</dt>
                  <dd>{result.upstreamStatus ?? "—"}{result.ms ? ` · ${result.ms}ms` : ""}</dd>
                </dl>

                {result.hint && (
                  <p className="text-sm text-destructive">{result.hint}</p>
                )}
                {result.upstreamError && (
                  <p className="text-sm text-destructive">{result.upstreamError}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
