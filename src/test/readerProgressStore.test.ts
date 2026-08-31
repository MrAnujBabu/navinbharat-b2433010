import { describe, it, expect, beforeEach } from "vitest";
import { getProgressFloor, raiseProgressFloor, resetProgressFloor } from "@/lib/readerProgressStore";

describe("reader progress floor (monotonic bar)", () => {
  beforeEach(() => resetProgressFloor(""));

  it("never decreases for the same document", () => {
    raiseProgressFloor("a.pdf", 40);
    expect(raiseProgressFloor("a.pdf", 8)).toBe(40);
    expect(raiseProgressFloor("a.pdf", 55)).toBe(55);
    expect(getProgressFloor("a.pdf")).toBe(55);
  });

  it("survives a remount (retry / byte-fallback) of the same document", () => {
    raiseProgressFloor("a.pdf", 62);
    // Simulated remount: a fresh overlay reads the floor instead of 0.
    expect(getProgressFloor("a.pdf")).toBe(62);
  });

  it("starts from zero for a different document", () => {
    raiseProgressFloor("a.pdf", 70);
    expect(getProgressFloor("b.pdf")).toBe(0);
    expect(raiseProgressFloor("b.pdf", 5)).toBe(5);
  });

  it("caps below 100 and ignores junk", () => {
    expect(raiseProgressFloor("a.pdf", 250)).toBe(99);
    expect(raiseProgressFloor("a.pdf", -1)).toBe(99);
    expect(raiseProgressFloor("a.pdf", Number.NaN)).toBe(99);
  });

  it("clears on ready so the next document opens at zero", () => {
    raiseProgressFloor("a.pdf", 80);
    resetProgressFloor();
    expect(getProgressFloor("a.pdf")).toBe(0);
  });
});
