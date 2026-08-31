// Admin-only Razorpay configuration probe.
//
// Answers exactly one question, without ever revealing a secret: are the
// Razorpay credentials this project runs on live or test, do they actually
// authenticate against Razorpay, and is the webhook secret configured?
// Used when switching between test and live keys so the switch is verifiable
// instead of guesswork.
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireRole } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireRole(req, corsHeaders, ["admin"]);
  if (!auth.ok) return auth.response;

  const keyId = (Deno.env.get("RAZORPAY_KEY_ID") || "").trim();
  const keySecret = (Deno.env.get("RAZORPAY_KEY_SECRET") || "").trim();
  const webhookSecret = (Deno.env.get("RAZORPAY_WEBHOOK_SECRET") || "").trim();

  const mode = keyId.startsWith("rzp_live_")
    ? "live"
    : keyId.startsWith("rzp_test_")
      ? "test"
      : keyId
        ? "unknown"
        : "missing";

  const result: Record<string, unknown> = {
    mode,
    keyIdPresent: keyId.length > 0,
    // Prefix only — never the key itself.
    keyIdPrefix: keyId ? `${keyId.slice(0, 12)}…` : null,
    keySecretPresent: keySecret.length > 0,
    webhookSecretPresent: webhookSecret.length > 0,
    authenticates: false,
  };

  if (keyId && keySecret) {
    const started = Date.now();
    try {
      // Cheapest authenticated read: list one order. 200 = credentials valid,
      // 401 = wrong id/secret pair (the usual test↔live mix-up).
      const res = await fetch("https://api.razorpay.com/v1/orders?count=1", {
        headers: { Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}` },
      });
      await res.text().catch(() => "");
      result.authenticates = res.ok;
      result.upstreamStatus = res.status;
      result.ms = Date.now() - started;
      if (res.status === 401) result.hint = "Key id and key secret do not match (test key with live secret, or vice versa).";
    } catch (e) {
      result.upstreamError = (e as Error).message;
    }
  }

  const ready = result.authenticates === true && webhookSecret.length > 0;
  return new Response(JSON.stringify({ ready, ...result }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
