import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  hmacSha256,
  timingSafeEqual,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "./razorpaySignature.ts";

const SECRET = "test_secret_key";

Deno.test("hmacSha256 matches the documented Razorpay digest shape", async () => {
  const digest = await hmacSha256(SECRET, "order_ABC|pay_XYZ");
  assertEquals(digest.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(digest), true);
});

Deno.test("timingSafeEqual rejects length and content mismatches", () => {
  assertEquals(timingSafeEqual("abc", "abc"), true);
  assertEquals(timingSafeEqual("abc", "abd"), false);
  assertEquals(timingSafeEqual("abc", "abcd"), false);
  assertEquals(timingSafeEqual("", ""), true);
});

Deno.test("verifyPaymentSignature accepts the genuine signature", async () => {
  const sig = await hmacSha256(SECRET, "order_ABC|pay_XYZ");
  assertEquals(
    await verifyPaymentSignature({
      orderId: "order_ABC",
      paymentId: "pay_XYZ",
      signature: sig,
      keySecret: SECRET,
    }),
    true,
  );
});

Deno.test("verifyPaymentSignature rejects forged / replayed pairs", async () => {
  const sig = await hmacSha256(SECRET, "order_ABC|pay_XYZ");
  // Same signature, different order → replay attempt.
  assertEquals(
    await verifyPaymentSignature({
      orderId: "order_OTHER",
      paymentId: "pay_XYZ",
      signature: sig,
      keySecret: SECRET,
    }),
    false,
  );
  // Wrong secret (test key secret against live signature).
  assertEquals(
    await verifyPaymentSignature({
      orderId: "order_ABC",
      paymentId: "pay_XYZ",
      signature: sig,
      keySecret: "other_secret",
    }),
    false,
  );
  // Missing pieces must never pass.
  assertEquals(
    await verifyPaymentSignature({
      orderId: "order_ABC",
      paymentId: "pay_XYZ",
      signature: "",
      keySecret: SECRET,
    }),
    false,
  );
});

Deno.test("verifyWebhookSignature is computed over the raw body", async () => {
  const rawBody = '{"event":"payment.captured","payload":{"a":1}}';
  const sig = await hmacSha256(SECRET, rawBody);
  assertEquals(
    await verifyWebhookSignature({ rawBody, signature: sig, webhookSecret: SECRET }),
    true,
  );
  // Re-serialized body (key order / whitespace drift) must fail.
  assertEquals(
    await verifyWebhookSignature({
      rawBody: JSON.stringify(JSON.parse(rawBody), null, 2),
      signature: sig,
      webhookSecret: SECRET,
    }),
    false,
  );
  // Missing header → unsigned request.
  assertEquals(
    await verifyWebhookSignature({ rawBody, signature: null, webhookSecret: SECRET }),
    false,
  );
});
