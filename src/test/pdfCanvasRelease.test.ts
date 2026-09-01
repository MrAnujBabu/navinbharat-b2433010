import { describe, expect, it } from "vitest";
import { LONG_DOCUMENT_PAGES, shouldReleaseDistantPages } from "../lib/pdfCanvasBudget";

describe("shouldReleaseDistantPages", () => {
  it("keeps neighbours mounted for short documents on a healthy device", () => {
    expect(shouldReleaseDistantPages(false, 1, 8, 8)).toBe(false);
  });

  it("releases distant pages once the document is long (unbounded canvas guard)", () => {
    expect(shouldReleaseDistantPages(false, 1, 8, LONG_DOCUMENT_PAGES + 1)).toBe(true);
    expect(shouldReleaseDistantPages(false, 1, 8, 300)).toBe(true);
  });

  it("still releases when zoomed in or on a low-memory archive scan", () => {
    expect(shouldReleaseDistantPages(false, 2, 8, 5)).toBe(true);
    expect(shouldReleaseDistantPages(true, 1, 2, 5)).toBe(true);
  });

  it("is unchanged when the page count is unknown", () => {
    expect(shouldReleaseDistantPages(false, 1, 8)).toBe(false);
  });
});
