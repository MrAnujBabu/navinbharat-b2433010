import { describe, it, expect } from "vitest";
import { buildNativeRazorpayPayload } from "../utils/razorpayNative";
import { UPI_FIRST_CHECKOUT_CONFIG } from "../utils/razorpay";

/**
 * UPI regression guard.
 *
 * The Android sheet lost its UPI section whenever a web-only checkout key
 * leaked into the native payload. These assertions fail loudly if either
 * `config.display.blocks` or the `method` filter map comes back.
 */
const baseOptions = {
  key: "rzp_live_abc123",
  amount: 49900,
  currency: "INR",
  name: "Naveen Bharat",
  description: "Class 11 Biology",
  order_id: "order_TestOrder123",
  prefill: { name: "A", email: "a@b.com", contact: "9876543210" },
  theme: { color: "#F97316" },
  ...UPI_FIRST_CHECKOUT_CONFIG,
};

describe("buildNativeRazorpayPayload", () => {
  it("drops the web-only display config", () => {
    const payload = buildNativeRazorpayPayload(baseOptions);
    expect(payload).not.toHaveProperty("config");
  });

  it("drops the method filter map so dashboard config drives the sheet", () => {
    const payload = buildNativeRazorpayPayload(baseOptions);
    expect(payload).not.toHaveProperty("method");
  });

  it("sends amount as a paise string and keeps the server order id", () => {
    const payload = buildNativeRazorpayPayload(baseOptions);
    expect(payload.amount).toBe("49900");
    expect(typeof payload.amount).toBe("string");
    expect(payload.order_id).toBe("order_TestOrder123");
  });

  it("never invents an order id client-side", () => {
    const payload = buildNativeRazorpayPayload({ ...baseOptions, order_id: "" });
    expect(payload.order_id).toBe("");
  });

  it("forwards prefill and theme untouched", () => {
    const payload = buildNativeRazorpayPayload(baseOptions);
    expect(payload.prefill).toEqual(baseOptions.prefill);
    expect(payload.theme).toEqual({ color: "#F97316" });
  });

  it("omits prefill entirely when there is nothing to prefill", () => {
    const { prefill: _drop, ...rest } = baseOptions;
    const payload = buildNativeRazorpayPayload(rest);
    expect(payload).not.toHaveProperty("prefill");
  });

  it("defaults currency to INR", () => {
    const payload = buildNativeRazorpayPayload({ ...baseOptions, currency: "" });
    expect(payload.currency).toBe("INR");
  });
});
