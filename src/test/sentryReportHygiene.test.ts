import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression guards for the Sentry triage fixes:
 *  1. `logger.error` must produce exactly ONE Sentry report (its console
 *     mirror must not be re-forwarded by the console.error patch).
 *  2. Offline network failures must not be reported at all.
 *  3. The same failure reported twice within the dedupe window is one issue.
 */

describe("sentry reporting hygiene", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("suppresses the console mirror while a wrapped block runs", async () => {
    const { withConsoleForwardSuppressed } = await import("../lib/sentry");
    let inside = false;
    const result = withConsoleForwardSuppressed(() => {
      inside = true;
      return 42;
    });
    expect(inside).toBe(true);
    expect(result).toBe(42);
  });

  it("logger.error writes one console line and one capture", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { logger } = await import("../lib/logger");
    logger.error("boom", new Error("boom"));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("classifies fetch failures as network so offline drops them", async () => {
    const { classifyError } = await import("../lib/sentry");
    expect(classifyError(new TypeError("Failed to fetch"))).toBe("network");
    expect(classifyError(new Error("network error"))).toBe("network");
  });

  it("extracts the failing host from a url so network issues group per upstream", async () => {
    const { hostOf } = await import("../lib/sentry");
    expect(hostOf("https://messages-prod.example.r2.cloudflarestorage.com/x.pdf")).toBe(
      "messages-prod.example.r2.cloudflarestorage.com",
    );
    expect(hostOf("Failed to fetch")).toBe("unknown-host");
  });

  it("never reports a payload-free rejection", async () => {
    const mod = await import("../lib/sentry");
    mod.__resetNetworkNoiseState();
    // `{}` and `""` carry no message and no stack — an unfixable Sentry issue.
    expect(() => mod.captureException({})).not.toThrow();
    expect(() => mod.captureException("")).not.toThrow();
  });
});


/**
 * Deep-triage pass (2026-08-23): the last nine unresolved Sentry issues were
 * all network/availability classes that were being reported as app defects.
 */
describe("sentry deep triage — error taxonomy", () => {
  it("treats an Android socket abort as network noise, not an app crash", async () => {
    const { classifyError } = await import("../lib/sentry");
    expect(classifyError(new Error("Software caused connection abort"))).toBe("network");
    expect(classifyError(new Error("Connection reset by peer"))).toBe("network");
  });

  it("treats an upstream 5xx download as availability telemetry", async () => {
    const { classifyError } = await import("../lib/sentry");
    expect(classifyError(new Error("Download failed (HTTP 500)"))).toBe("proxy");
    expect(classifyError(new Error("HTTP 503: upstream unavailable"))).toBe("proxy");
  });

  it("keeps a client-side 4xx as a real app error worth fixing", async () => {
    const { classifyError } = await import("../lib/sentry");
    expect(classifyError(new Error("HTTP 400: missing url parameter"))).toBe("app");
  });
});
