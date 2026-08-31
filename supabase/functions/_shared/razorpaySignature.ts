// Single source of truth for Razorpay HMAC verification.
//
// Four functions used to carry their own copy of hmacSha256 + timingSafeEqual
// (verify-razorpay-payment, verify-subscription-payment, razorpay-webhook,
// razorpay-refund-webhook). Divergence there is a security bug waiting to
// happen — one copy losing the timing-safe compare, or one comparing
// case-sensitively against a differently-cased hex digest.
//
// Razorpay contracts implemented here:
//   • checkout callback → HMAC_SHA256("<order_id>|<payment_id>", KEY_SECRET)
//   • webhook           → HMAC_SHA256(<raw request body>, WEBHOOK_SECRET)
// Both are lowercase hex.

/** Constant-time string compare. Returns false on length mismatch. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  let result = 0;
  for (let i = 0; i < bufA.length; i++) result |= bufA[i] ^ bufB[i];
  return result === 0;
}

/** Lowercase hex HMAC-SHA256 of `data` keyed with `key`. */
export async function hmacSha256(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify a Razorpay checkout callback signature.
 * `SHA256(order_id + "|" + payment_id, RAZORPAY_KEY_SECRET)`.
 */
export async function verifyPaymentSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
  keySecret: string;
}): Promise<boolean> {
  const { orderId, paymentId, signature, keySecret } = params;
  if (!orderId || !paymentId || !signature || !keySecret) return false;
  const expected = await hmacSha256(keySecret, `${orderId}|${paymentId}`);
  return timingSafeEqual(expected, signature);
}

/**
 * Verify a Razorpay webhook signature over the RAW request body.
 * Never re-serialize the parsed JSON before calling this — key order and
 * whitespace changes break the digest.
 */
export async function verifyWebhookSignature(params: {
  rawBody: string;
  signature: string | null;
  webhookSecret: string;
}): Promise<boolean> {
  const { rawBody, signature, webhookSecret } = params;
  if (!signature || !webhookSecret) return false;
  const expected = await hmacSha256(webhookSecret, rawBody);
  return timingSafeEqual(expected, signature);
}
