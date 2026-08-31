// Single credential loader for every Razorpay edge function.
//
// Keeps three things in one place that were previously copy-pasted:
//   1. reading RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET
//   2. the "not configured" failure
//   3. the key-prefix sanity check (test vs live), which is what catches a
//      half-finished test→live switch before a student sees a broken checkout.

export type RazorpayMode = "test" | "live" | "unknown" | "missing";

export interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
  mode: RazorpayMode;
}

export function razorpayMode(keyId: string): RazorpayMode {
  if (!keyId) return "missing";
  if (keyId.startsWith("rzp_live_")) return "live";
  if (keyId.startsWith("rzp_test_")) return "test";
  return "unknown";
}

/**
 * Load the API credentials. Returns `null` when either half is missing so the
 * caller can return its own 500 with its own CORS headers.
 */
export function loadRazorpayCredentials(): RazorpayCredentials | null {
  const keyId = (Deno.env.get("RAZORPAY_KEY_ID") || "").trim();
  const keySecret = (Deno.env.get("RAZORPAY_KEY_SECRET") || "").trim();
  if (!keyId || !keySecret) return null;
  const mode = razorpayMode(keyId);
  if (mode === "unknown") {
    // Prefix only — never log the key itself.
    console.error("[razorpay] RAZORPAY_KEY_ID has unexpected prefix", {
      prefix: keyId.slice(0, 8),
    });
  }
  return { keyId, keySecret, mode };
}

/** Webhook signing secret, or null when unset. */
export function loadRazorpayWebhookSecret(): string | null {
  const secret = (Deno.env.get("RAZORPAY_WEBHOOK_SECRET") || "").trim();
  return secret || null;
}
