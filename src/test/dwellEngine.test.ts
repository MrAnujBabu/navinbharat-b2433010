import { describe, it, expect } from "vitest";
import {
  clampDwellSeconds,
  crossedBoundary,
  crossedTarget,
  dwellTargets,
  pageStops,
  isRouteMode,
  normalizeDwell,
  parseDwell,
  parsePageList,
  parseRouteList,
  waypointReached,
  DEFAULT_DWELL,
  MAX_LIST_LENGTH,
  DWELL_SLIDER_STEPS,
  dwellStepIndex,
} from "../lib/reader/dwellEngine";

describe("page list parsing", () => {
  it("sorts, dedupes and drops junk", () => {
    // Non-digits are separators, so "-4" contributes the page 4.
    expect(parsePageList("1, 5, 3 2;8, 0, -4, abc")).toEqual([1, 2, 3, 4, 5, 8]);
  });

  it("keeps route order and collapses only consecutive repeats", () => {
    expect(parseRouteList("6, 3, 3, 8, 2, 6")).toEqual([6, 3, 8, 2, 6]);
  });
  it("caps list length so the rAF loop stays cheap", () => {
    const raw = Array.from({ length: MAX_LIST_LENGTH + 50 }, (_, i) => i + 1).join(",");
    expect(parsePageList(raw)).toHaveLength(MAX_LIST_LENGTH);
    expect(parseRouteList(raw)).toHaveLength(MAX_LIST_LENGTH);
  });
});

describe("dwell settings normalisation", () => {
  it("clamps seconds into 1..3600", () => {
    expect(clampDwellSeconds(1)).toBe(1);
    expect(clampDwellSeconds(0)).toBe(1);

    expect(clampDwellSeconds(600)).toBe(600);
    expect(clampDwellSeconds(3600)).toBe(3600);
    expect(clampDwellSeconds(99999)).toBe(3600);
    expect(clampDwellSeconds("nope")).toBe(DEFAULT_DWELL.seconds);
  });
  it("falls back to odd parity for unknown values", () => {
    expect(normalizeDwell({ parity: "weird" as never }).parity).toBe("odd");
  });
  it("returns null for malformed JSON", () => {
    expect(parseDwell("{not json")).toBeNull();
    expect(parseDwell(null)).toBeNull();
  });
});

describe("crossing math", () => {
  const cfg = { ...DEFAULT_DWELL, enabled: true, parity: "all" as const, seconds: 10 };
  const tops = [
    { page: 1, top: 0 },
    { page: 2, top: 500 },
    { page: 3, top: 1000 },
  ];
  it("picks the first boundary going down, the last going up", () => {
    expect(crossedBoundary(tops, 400, 1100, 1, cfg)?.page).toBe(2);
    expect(crossedBoundary(tops, 1100, 400, -1, cfg)?.page).toBe(3);
  });
  it("honours custom page lists", () => {
    const custom = { ...cfg, parity: "custom" as const, pages: [3] };
    expect(crossedBoundary(tops, 400, 1100, 1, custom)?.page).toBe(3);
  });
  it("detects a waypoint the step jumped over", () => {
    expect(waypointReached(480, 520, 500)).toBe(true);
    expect(waypointReached(100, 200, 500)).toBe(false);
  });
  it("only treats a populated route as route mode", () => {
    expect(isRouteMode({ ...cfg, parity: "route", route: [] })).toBe(false);
    expect(isRouteMode({ ...cfg, parity: "route", route: [2] })).toBe(true);
  });
});

describe("dwell slider ladder", () => {
  it("spans 1s to 1h and is strictly increasing", () => {
    expect(DWELL_SLIDER_STEPS[0]).toBe(1);
    expect(DWELL_SLIDER_STEPS[DWELL_SLIDER_STEPS.length - 1]).toBe(3600);
    for (let i = 1; i < DWELL_SLIDER_STEPS.length; i++) {
      expect(DWELL_SLIDER_STEPS[i]).toBeGreaterThan(DWELL_SLIDER_STEPS[i - 1]);
    }
  });
  it("maps a stored value back to the nearest slider position", () => {
    expect(DWELL_SLIDER_STEPS[dwellStepIndex(1)]).toBe(1);
    expect(DWELL_SLIDER_STEPS[dwellStepIndex(60)]).toBe(60);
    expect(DWELL_SLIDER_STEPS[dwellStepIndex(3600)]).toBe(3600);
    expect(DWELL_SLIDER_STEPS[dwellStepIndex(31)]).toBe(30);
  });
});

describe("A4 Sheet mode", () => {
  const base = { ...DEFAULT_DWELL, enabled: true, parity: "all" as const, seconds: 10 };
  const boxes = [
    { page: 1, top: 0, height: 1400 },
    { page: 2, top: 1400, height: 1400 },
  ];

  it("returns a single stop for a page that fits the viewport", () => {
    expect(pageStops(0, 500, 600)).toEqual([0]);
  });

  it("splits a tall page into overlapping screenfuls ending at the bottom", () => {
    const stops = pageStops(0, 1400, 600);
    expect(stops[0]).toBe(0);
    expect(stops.length).toBeGreaterThan(1);
    expect(stops[stops.length - 1]).toBe(800); // 1400 - 600
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i]).toBeGreaterThan(stops[i - 1]);
      expect(stops[i] - stops[i - 1]).toBeLessThanOrEqual(600);
    }
  });

  it("keeps classic behaviour when the toggle is off", () => {
    const targets = dwellTargets(boxes, base, 600);
    expect(targets.map((t) => t.top)).toEqual([0, 1400]);
  });

  it("adds in-page stops for every matching page when on", () => {
    const targets = dwellTargets(boxes, { ...base, a4: true }, 600);
    expect(targets.length).toBeGreaterThan(2);
    expect(targets[0]).toMatchObject({ page: 1, index: 0, top: 0 });
    // still ascending, and page 2 stops come after page 1 stops
    for (let i = 1; i < targets.length; i++) {
      expect(targets[i].top).toBeGreaterThan(targets[i - 1].top);
    }
    expect(targets.some((t) => t.page === 1 && t.index === 1)).toBe(true);
  });

  it("respects parity / custom lists in A4 mode", () => {
    const targets = dwellTargets(boxes, { ...base, a4: true, parity: "custom", pages: [2] }, 600);
    expect(targets.every((t) => t.page === 2)).toBe(true);
  });

  it("picks the first target going down and the last going up", () => {
    const targets = dwellTargets(boxes, { ...base, a4: true }, 600);
    const down = crossedTarget(targets, 0, 1400, 1);
    const up = crossedTarget(targets, 1400, 0, -1);
    expect(down?.top).toBeGreaterThan(0);
    expect(up?.top).toBeLessThanOrEqual(1400);
    expect(up!.top).toBeGreaterThan(down!.top);
  });

  it("defaults a4 to false for older stored settings", () => {
    expect(normalizeDwell({ enabled: true } as never).a4).toBe(false);
    expect(DEFAULT_DWELL.a4).toBe(false);
  });
});
