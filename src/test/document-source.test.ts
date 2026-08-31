import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      refreshSession: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));


import { documentSourceCandidates } from "../lib/fetchDocumentBlob";

describe("documentSourceCandidates", () => {
  it("always ends with the direct URL", () => {
    const list = documentSourceCandidates("https://example.com/a.pdf");
    expect(list[list.length - 1]).toContain("example.com/a.pdf");
  });

  it("puts the Drive proxy before the raw Drive link", () => {
    const list = documentSourceCandidates("https://drive.google.com/file/d/ABC123/view");
    expect(list[0]).toContain("pdf-proxy");
    expect(list.length).toBeGreaterThan(1);
  });

  it("does not repeat identical candidates", () => {
    const list = documentSourceCandidates("https://example.com/a.pdf");
    expect(new Set(list).size).toBe(list.length);
  });
});
