import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isWarmableSource, warmPdfSource, __resetWarmPdfSource } from "../lib/warmPdfSource";

describe("isWarmableSource", () => {
  it("matches the two slow-resolve hosts only", () => {
    expect(isWarmableSource("https://archive.org/details/Botany")).toBe(true);
    expect(isWarmableSource("https://ia801509.us.archive.org/12/items/x/x.pdf")).toBe(true);
    expect(isWarmableSource("https://prod-recordings.vedantu.com/NOTES/PROD/a.pdf")).toBe(true);
    expect(isWarmableSource("https://cdn.jsdelivr.net/gh/a/b/x.pdf")).toBe(false);
    expect(isWarmableSource("https://drive.google.com/file/d/abc/view")).toBe(false);
    expect(isWarmableSource(null)).toBe(false);
  });
});

describe("warmPdfSource", () => {
  const originalRIC = (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;

  beforeEach(() => {
    __resetWarmPdfSource();
    (window as unknown as { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback =
      (cb: () => void) => { cb(); return 1; };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ body: null }));
  });

  afterEach(() => {
    (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback = originalRIC;
    vi.unstubAllGlobals();
  });

  it("issues a single 0-byte range request per URL", () => {
    const url = "https://x.supabase.co/functions/v1/pdf-proxy?kind=archive&id=Botany";
    warmPdfSource(url, "https://archive.org/details/Botany");
    warmPdfSource(url, "https://archive.org/details/Botany");
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { Range: "bytes=0-0" } });
  });

  it("skips sources that do not benefit", () => {
    warmPdfSource("https://x.supabase.co/functions/v1/pdf-proxy?kind=url&url=y", "https://cdn.jsdelivr.net/x.pdf");
    expect(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("never throws when fetch is unavailable", () => {
    vi.stubGlobal("fetch", () => { throw new Error("no network"); });
    expect(() =>
      warmPdfSource("https://x.supabase.co/functions/v1/pdf-proxy?kind=archive&id=A", "https://archive.org/details/A"),
    ).not.toThrow();
  });
});
