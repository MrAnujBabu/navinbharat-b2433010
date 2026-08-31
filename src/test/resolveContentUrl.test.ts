import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractContentPath, resolveContentUrl } from "../lib/resolveContentUrl";

vi.mock("../integrations/supabase/client", () => {
  const createSignedUrl = vi.fn();
  const getPublicUrl = vi.fn(() => ({ data: { publicUrl: "https://cdn.example/public.png" } }));
  return {
    supabase: {
      storage: { from: () => ({ createSignedUrl, getPublicUrl }) },
      auth: { getSession: async () => ({ data: { session: null } }) },
      from: () => ({ insert: async () => ({ error: null }) }),
      __mocks: { createSignedUrl, getPublicUrl },
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mocks = (await import("../integrations/supabase/client")).supabase as any;

describe("extractContentPath", () => {
  it("parses storage:// URIs", () => {
    expect(extractContentPath("storage://content/lessons/abc.pdf")).toBe("lessons/abc.pdf");
  });
  it("parses legacy public HTTP URLs for THIS project", () => {
    expect(
      extractContentPath(
        "https://cmbattmjwriiesibayfk.supabase.co/storage/v1/object/public/content/hero-banners/1.png"
      )
    ).toBe("hero-banners/1.png");
  });
  it("ignores URLs from a different Supabase project (stale migrated rows)", () => {
    expect(
      extractContentPath(
        "https://yigafgqqypnzebrdlbgj.supabase.co/storage/v1/object/public/content/thumbnails/a.png"
      )
    ).toBeNull();
  });
  it("returns null for external URLs", () => {
    expect(extractContentPath("https://notion.so/foo")).toBeNull();
    expect(extractContentPath(null)).toBeNull();
  });
});

describe("resolveContentUrl", () => {
  beforeEach(() => {
    mocks.__mocks.createSignedUrl.mockReset();
    mocks.__mocks.getPublicUrl.mockClear();
  });

  it("passes external URLs through untouched", async () => {
    const r = await resolveContentUrl("https://notion.so/x");
    expect(r).toBe("https://notion.so/x");
    expect(mocks.__mocks.createSignedUrl).not.toHaveBeenCalled();
  });

  // The `content` bucket is private, so a public CDN URL answers HTTP 400 even
  // for presentation folders — they must be signed (anon is allowed to sign
  // them by storage RLS).
  it("signs presentation folders instead of returning a dead public URL", async () => {
    mocks.__mocks.createSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: "https://signed.example/hero-banners/a.png?token=b1" },
      error: null,
    });
    const url =
      "https://cmbattmjwriiesibayfk.supabase.co/storage/v1/object/public/content/hero-banners/a.png";
    expect(await resolveContentUrl(url)).toContain("token=b1");
    expect(mocks.__mocks.createSignedUrl).toHaveBeenCalled();
  });

  it("signs storage:// presentation URIs and caches the result", async () => {
    mocks.__mocks.createSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: "https://signed.example/thumbnails/x.png?token=b2" },
      error: null,
    });
    expect(await resolveContentUrl("storage://content/thumbnails/x.png")).toContain("token=b2");
    // second call is served from cache — no extra round-trip
    expect(await resolveContentUrl("storage://content/thumbnails/x.png")).toContain("token=b2");
    expect(mocks.__mocks.createSignedUrl).toHaveBeenCalledTimes(1);
  });


  it("signs gated folder paths", async () => {
    mocks.__mocks.createSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: "https://signed.example/lessons/a.pdf?token=xyz" },
      error: null,
    });
    const r = await resolveContentUrl("storage://content/lessons/a.pdf");
    expect(r).toContain("token=xyz");
  });

  it("returns null and logs on sign failure (401/403)", async () => {
    mocks.__mocks.createSignedUrl.mockResolvedValueOnce({
      data: null,
      error: { message: "Unauthorized" },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await resolveContentUrl("storage://content/lessons/denied.pdf");
    expect(r).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "[resolveContentUrl] failure",
      expect.objectContaining({ code: "sign_failed", path: "lessons/denied.pdf" })
    );
    warn.mockRestore();
  });

  it("classifies a missing object quietly, not as sign_failed", async () => {
    mocks.__mocks.createSignedUrl.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Either the object does not exist or you do not have access to it",
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const r = await resolveContentUrl("storage://content/lessons/gone-once.pdf");
    expect(r).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      "[resolveContentUrl] missing object (placeholder used)",
      { path: "lessons/gone-once.pdf" }
    );

    warn.mockRestore();
    info.mockRestore();
  });


  it("returns null when signed URL is empty", async () => {
    mocks.__mocks.createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: "" }, error: null });
    const r = await resolveContentUrl("storage://content/lessons/empty.pdf");
    expect(r).toBeNull();
  });

  it("respects custom TTL", async () => {
    mocks.__mocks.createSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: "https://signed.example/a?token=t" },
      error: null,
    });
    await resolveContentUrl("storage://content/materials/x.pdf", 30);
    expect(mocks.__mocks.createSignedUrl).toHaveBeenCalledWith("materials/x.pdf", 30);
  });
});
