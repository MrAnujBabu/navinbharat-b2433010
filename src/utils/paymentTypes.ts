/**
 * Single source of truth for the client-side Razorpay payload shapes.
 *
 * Why: `razorpay.ts` (web SDK) and `razorpayNative.ts` (Capacitor plugin)
 * each declared their own `RazorpaySuccessResponse`. Two structurally equal
 * but separate types drift the moment one side gains a field, and callers
 * that accept "either checkout result" had no shared type to name. Both
 * wrappers now re-export from here, so importers can keep using either
 * module path.
 */

/** Payload Razorpay hands back on a successful checkout (web and native). */
export interface RazorpaySuccessResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

/** Structured failure fields Razorpay exposes on `payment.failed`. */
export interface RazorpayPaymentError {
  code?: string;
  description?: string;
  source?: string;
  step?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/** Prefill block shared by both checkout surfaces. */
export interface RazorpayPrefill {
  name?: string;
  email?: string;
  contact?: string;
  /** `'upi'` opens the checkout directly on the UPI tab. */
  method?: string;
}

/**
 * Credentials + order returned by the `create-razorpay-order` edge function.
 * The client NEVER holds a key of its own — `key_id` always comes from the
 * server, which is what makes the test → live swap a secrets-only change.
 */
export interface CreatedRazorpayOrder {
  order_id: string;
  /** `rzp_test_…` or `rzp_live_…`, issued server-side. */
  key_id: string;
  /** Integer paise. */
  amount: number;
  currency?: string;
}

/** True when the server handed us a live-mode key. */
export const isLiveRazorpayKey = (keyId: string | undefined | null): boolean =>
  typeof keyId === "string" && keyId.startsWith("rzp_live_");
