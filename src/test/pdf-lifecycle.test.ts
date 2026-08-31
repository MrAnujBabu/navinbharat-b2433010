import { describe, expect, it, vi } from "vitest";
import { emitPdfLifecycle, pdfLifecycleMatches } from "@/lib/pdfLifecycle";

describe("PDF lifecycle isolation", () => {
  it("matches only the active reader identity", () => {
    const event = new CustomEvent("pdf-progress", { detail: { readerId: "reader-a", percent: 20 } });
    expect(pdfLifecycleMatches(event, "reader-a")).toBe(true);
    expect(pdfLifecycleMatches(event, "reader-b")).toBe(false);
  });

  it("emits scoped lifecycle details", () => {
    const listener = vi.fn();
    window.addEventListener("pdf-ready", listener);
    emitPdfLifecycle("pdf-ready", "reader-a", { percent: 100 });
    const event = listener.mock.calls[0]?.[0] as CustomEvent;
    expect(event.detail).toMatchObject({ readerId: "reader-a", percent: 100 });
    window.removeEventListener("pdf-ready", listener);
  });
});