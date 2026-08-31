// Native Razorpay checkout wrapper (Capacitor Android/iOS).
// Uses the official `capacitor-razorpay` plugin which opens the native
// Razorpay SDK sheet — this is what allows UPI intents to launch PhonePe,
// Google Pay and Paytm directly without going through an in-app browser.
import { addBreadcrumb } from "../lib/sentry";
import type { RazorpaySuccessResponse } from "./paymentTypes";

export interface NativeRazorpayOptions {
  key: string;
  amount: number; // in paise
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: { name?: string; email?: string; contact?: string; method?: string };
  theme?: { color?: string };
  /** Web-checkout method toggles — forwarded to the native SDK as-is. */
  method?: Record<string, boolean>;
  /** Web-only `config.display` blocks — stripped before the native call. */
  config?: unknown;
}


// Shared with the web wrapper — see paymentTypes.ts.
export type { RazorpaySuccessResponse } from "./paymentTypes";

export class RazorpayCancelledError extends Error {
  constructor() {
    super("Payment cancelled");
    this.name = "RazorpayCancelledError";
  }
}

/**
 * Structured Razorpay failure raised from the native plugin. Carries the
 * same fields the web `payment.failed` event exposes, so callers can pass
 * this straight to `formatRazorpayError()` instead of regexing on `.message`.
 */
export class RazorpayNativeError extends Error {
  code?: string;
  description?: string;
  source?: string;
  step?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  constructor(fields: {
    code?: string; description?: string; source?: string;
    step?: string; reason?: string; metadata?: Record<string, unknown>;
  }, fallbackMessage: string) {
    super(fields.description && fields.description !== "undefined"
      ? fields.description
      : fallbackMessage);
    this.name = "RazorpayNativeError";
    this.code = fields.code;
    this.description = fields.description;
    this.source = fields.source;
    this.step = fields.step;
    this.reason = fields.reason;
    this.metadata = fields.metadata;
  }
}

const CANCEL_HINTS = [
  "cancel",
  "dismiss",
  "back_pressed",
  "user closed",
  "payment did not complete",
];

const looksLikeCancel = (msg: string): boolean => {
  const lower = msg.toLowerCase();
  return CANCEL_HINTS.some((h) => lower.includes(h));
};

export interface NormalizedRazorpayError {
  code?: string; description?: string; source?: string;
  step?: string; reason?: string; metadata?: Record<string, unknown>;
}

const FIELD_ALIASES: Record<keyof NormalizedRazorpayError, string[]> = {
  code: ["code", "errorCode", "error_code"],
  description: ["description", "message", "errorMessage", "error_description", "desc"],
  source: ["source"],
  step: ["step"],
  reason: ["reason"],
  metadata: ["metadata"],
};

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (!value) return null;
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch { /* not JSON */ }
    }
  }
  return null;
};

/**
 * Version-proof extraction of Razorpay's structured error.
 *
 * Instead of hardcoding the 3 shapes we've seen from `capacitor-razorpay`, we
 * walk the thrown value (depth <= 3, cycle-safe) and pick up the first match
 * for each known field — including common aliases and JSON-string payloads.
 * A brand-new plugin shape therefore still yields usable fields instead of
 * falling through to a generic message.
 */
export const normalizeNativeError = (input: unknown): NormalizedRazorpayError => {
  const out: NormalizedRazorpayError = {};
  const seen = new Set<unknown>();

  const visit = (value: unknown, depth: number) => {
    if (depth > 3) return;
    const obj = asObject(value);
    if (!obj || seen.has(obj)) return;
    seen.add(obj);

    for (const key of Object.keys(FIELD_ALIASES) as (keyof NormalizedRazorpayError)[]) {
      if (out[key] !== undefined) continue;
      for (const alias of FIELD_ALIASES[key]) {
        const raw = (obj as Record<string, unknown>)[alias];
        if (key === "metadata") {
          const meta = asObject(raw);
          if (meta) { out.metadata = meta as Record<string, unknown>; break; }
          continue;
        }
        if (typeof raw === "string" && raw.trim() && raw !== "undefined" && raw !== "null") {
          // A JSON blob hiding in a string field → recurse instead of using it.
          if (asObject(raw)) break;
          (out as Record<string, unknown>)[key] = raw.trim();
          break;
        }
        if (typeof raw === "number") { (out as Record<string, unknown>)[key] = String(raw); break; }
      }
    }

    // Recurse into nested containers where plugins wrap the real error.
    for (const nestedKey of ["error", "response", "data", "details", "payload", "cause", "body", "result", "message", "errorMessage"]) {
      const nested = (obj as Record<string, unknown>)[nestedKey];
      if (nested && (typeof nested === "object" || typeof nested === "string")) {
        visit(nested, depth + 1);
      }
    }
  };

  visit(input, 0);

  // Plain-string throw with no structure at all.
  if (!out.description) {
    const raw = typeof input === "string"
      ? input
      : ((input as { message?: string; errorMessage?: string })?.message
        || (input as { errorMessage?: string })?.errorMessage
        || "");
    if (raw && !asObject(raw)) out.description = raw;
  }

  if (!out.code && !out.step && !out.reason && !out.description) {
    out.reason = "unknown";
    try {
      // Truncated raw payload for debugging future plugin shapes. No keys or
      // PII are present in Razorpay failure payloads.
      console.warn("[razorpay-native] unrecognised error shape:", JSON.stringify(input)?.slice(0, 500));
    } catch {
      console.warn("[razorpay-native] unrecognised non-serialisable error shape");
    }
  }

  return out;
};

/** @deprecated kept for backwards compatibility — use {@link normalizeNativeError}. */
const extractRazorpayError = normalizeNativeError;

/**
 * Builds the exact options object handed to the Razorpay Android/iOS SDK.
 *
 * Exported so the UPI regression test can assert the payload shape without
 * booting Capacitor.
 *
 * Two web-only keys are deliberately dropped:
 *
 * - `config.display.blocks` — a browser-checkout feature. The native SDK
 *   cannot deserialise the nested structure and silently degrades to a
 *   card-only sheet, which is exactly the "APK me UPI nahi aa raha" symptom.
 * - `method: { upi: true, card: true, ... }` — web checkout treats this map as
 *   a filter, but the Android SDK's option parser is stricter and a rejected
 *   map collapses the sheet to its built-in fallback set. On native the
 *   available methods must come from the Razorpay dashboard configuration,
 *   which already has UPI enabled. Sending nothing is what the Android
 *   integration docs prescribe.
 *
 * UPI app discovery on Android 11+ depends on the `<queries>` block in
 * AndroidManifest.xml (upi scheme + GPay / PhonePe / Paytm / BHIM / CRED
 * packages), not on anything in this payload.
 */
export const buildNativeRazorpayPayload = (
  options: NativeRazorpayOptions
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    key: options.key,
    // The native SDK expects the amount as a string of paise.
    amount: String(options.amount),
    currency: options.currency || "INR",
    name: options.name,
    description: options.description,
    order_id: options.order_id,
    modal: { confirm_close: true },
    retry: { enabled: true, max_count: 2 },
  };

  if (options.prefill) payload.prefill = options.prefill;
  if (options.theme) payload.theme = options.theme;

  return payload;
};

/** Native sheet must appear within this window or we free the Buy button. */
const NATIVE_OPEN_TIMEOUT_MS = 90_000;

/**
 * Opens the native Razorpay checkout sheet and resolves with the success
 * payload. Throws {@link RazorpayCancelledError} when the user dismisses the
 * sheet, and a regular Error for real failures (declined card, signature
 * mismatch, etc.) so callers can show the right UX.
 */
export const openNativeRazorpayCheckout = async (
  options: NativeRazorpayOptions
): Promise<RazorpaySuccessResponse> => {
  let Checkout: any;
  try {
    ({ Checkout } = await import("capacitor-razorpay"));
  } catch {
    throw new Error(
      "Native payment module is missing. Please update the app from the Play Store."
    );
  }

  const payload = buildNativeRazorpayPayload(options);


  let result: any;
  try {
    const keyMode = options.key.startsWith("rzp_live_") ? "live"
      : options.key.startsWith("rzp_test_") ? "test"
      : "unknown";
    addBreadcrumb('payment', 'razorpay:open', {
      order_id: options.order_id,
      order_prefix: options.order_id.slice(0, 14),
      mode: 'native',
      key_mode: keyMode,
      amount: options.amount,
      currency: options.currency,
      // Method availability now comes from the Razorpay dashboard, not from a
      // client-side map — record the payload keys so a future regression is a
      // Sentry lookup instead of a rebuild-and-guess cycle.
      payload_keys: Object.keys(payload).sort().join(','),
      // Razorpay's recommended/preferred-methods block needs the customer
      // contact — track it so a missing number is visible in Sentry.
      has_contact: Boolean(options.prefill?.contact),
    });
    // `Checkout.open()` swallows its own launch exception in the Android
    // plugin (see capacitor-razorpay Checkout.java) — a failed Intent leaves
    // the promise pending forever and pins the Buy button on "Processing…".
    // The race below guarantees the caller always gets an answer.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      result = await Promise.race([
        Checkout.open(payload),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Checkout could not start. Please check your internet connection and try again.")),
            NATIVE_OPEN_TIMEOUT_MS
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }

  } catch (e: any) {
    const msg = e?.message || e?.errorMessage || String(e ?? "");
    if (looksLikeCancel(msg)) throw new RazorpayCancelledError();
    // Preserve Razorpay's structured error (step / reason / code) so the
    // caller can render an actionable message instead of "undefined".
    const fields = extractRazorpayError(e);
    throw new RazorpayNativeError(fields, msg || "Payment failed");
  }

  // The plugin returns `{ response: string | object }` — newer versions
  // already parse the JSON, older versions return a stringified payload.
  let parsed: any = result?.response ?? result;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      // Some plugin versions return the payment id directly as a string —
      // surface it as razorpay_payment_id so callers don't crash, but the
      // signature won't be available. The server-side verifier will reject
      // it and surface a friendly error.
      parsed = { razorpay_payment_id: parsed };
    }
  }

  if (!parsed?.razorpay_payment_id) {
    throw new RazorpayCancelledError();
  }

  return {
    razorpay_payment_id: parsed.razorpay_payment_id,
    razorpay_order_id: parsed.razorpay_order_id ?? options.order_id,
    razorpay_signature: parsed.razorpay_signature,
  };
};
