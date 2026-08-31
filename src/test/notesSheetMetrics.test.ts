/**
 * Notes sheet must never collapse.
 *
 * The reader's writing surface is sized from the soft-keyboard inset, and a
 * transient over-large inset (Android WebView reports one mid-animation) used
 * to leave a zero-height sheet. These tests pin the floor and the ceiling.
 */

import { describe, it, expect } from "vitest";
import { notesSheetMetrics, MIN_SHEET_HEIGHT } from "../lib/reader/notesSheetMetrics";

describe("notesSheetMetrics", () => {
  it("uses ~70% of the viewport when the keyboard is closed", () => {
    const { bottom, height } = notesSheetMetrics(844, 0);
    expect(bottom).toBe(0);
    expect(height).toBe(Math.round(844 * 0.7));
  });

  it("sits above the keyboard and fills the space left", () => {
    const { bottom, height } = notesSheetMetrics(844, 336);
    expect(bottom).toBe(336);
    expect(height).toBe(844 - 336 - 12);
  });

  it("never collapses, even when the inset claims the whole screen", () => {
    for (const inset of [700, 844, 2000]) {
      const { height } = notesSheetMetrics(844, inset);
      expect(height).toBeGreaterThanOrEqual(MIN_SHEET_HEIGHT);
    }
  });

  it("never collapses in landscape, where the keyboard eats most of the height", () => {
    const { height, bottom } = notesSheetMetrics(390, 300);
    expect(height).toBeGreaterThanOrEqual(MIN_SHEET_HEIGHT);
    expect(bottom).toBeLessThanOrEqual(Math.round(390 * 0.7));
  });

  it("never renders taller than the viewport", () => {
    for (const [vh, inset] of [[844, 0], [390, 200], [200, 150], [0, 0]] as const) {
      const { height } = notesSheetMetrics(vh, inset);
      expect(height).toBeLessThanOrEqual(Math.max(vh, MIN_SHEET_HEIGHT));
    }
  });
});
