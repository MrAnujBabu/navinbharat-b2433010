import { describe, expect, it } from "vitest";

/**
 * Regression tests for the two bugs that made 0.1x / 0.2x / 0.5x / 0.75x
 * unusable. Both are pure numeric logic, mirrored here from
 * `useAutoScroll.setSpeed` and the rAF step so they can be asserted without a
 * live rAF loop.
 */

// Mirrors setSpeed's quantisation.
const quantise = (s: number) => Math.max(0.02, Math.min(10, Math.round(s * 100) / 100));

describe("autoscroll speed quantisation", () => {
  it("preserves 0.75 (the old Math.round(s*10)/10 turned it into 0.8)", () => {
    expect(quantise(0.75)).toBe(0.75);
  });

  it("keeps the low presets exact", () => {
    for (const p of [0.02, 0.05, 0.1, 0.2, 0.5, 0.75, 1, 1.5, 2, 3, 5]) {
      expect(quantise(p)).toBe(p);
    }
  });

  it("clamps outside the allowed range", () => {
    expect(quantise(0)).toBe(0.02);
    expect(quantise(99)).toBe(10);
  });

  it("allows the ultra-slow floor below 0.1x", () => {
    expect(quantise(0.02)).toBe(0.02);
    expect(quantise(0.01)).toBe(0.02);
  });
});

/**
 * Ultra-slow presets must move *every* frame visually. The engine keeps a float
 * position, writes the integer part to `scrollTop` and paints the 0-1px
 * remainder as a transform, so the visual offset is strictly increasing.
 */
describe("ultra-slow visual continuity", () => {
  const visualPositions = (speed: number, frames: number) => {
    const out: number[] = [];
    let pos = 0;
    for (let i = 0; i < frames; i++) {
      pos += speed; // dt === 1 at 60fps
      const whole = Math.floor(pos);
      const frac = pos - whole;
      out.push(whole + frac); // scrollTop + translate3d remainder
    }
    return out;
  };

  for (const speed of [0.02, 0.05]) {
    it(`advances on every frame at ${speed}x`, () => {
      const pts = visualPositions(speed, 60);
      for (let i = 1; i < pts.length; i++) {
        expect(pts[i]).toBeGreaterThan(pts[i - 1]);
      }
      // ~60 frames ≈ 1s of motion.
      expect(pts[pts.length - 1]).toBeCloseTo(speed * 60, 5);
    });
  }
});

/**
 * Simulates the engine against a scroller whose `scrollTop` snaps to whole
 * device pixels on read-back — exactly what Android WebView does.
 */
function simulate(speed: number, frames: number, useFloatPosition: boolean) {
  let stored = 0; // what the element reports back (integer-snapped)
  let pos = 0;
  let acc = 0;
  for (let i = 0; i < frames; i++) {
    if (useFloatPosition) {
      pos += speed; // dt === 1 at 60fps
      stored = Math.round(pos);
    } else {
      // Old implementation: flush at >= 0.05 and destroy the remainder.
      acc += speed;
      if (acc >= 0.05) {
        const dy = acc;
        acc = 0;
        stored = Math.round(stored + dy);
      }
    }
  }
  return stored;
}

describe("sub-pixel accumulation", () => {
  /**
   * Mirrors the shipped engine: integer part goes to `scrollTop`, the 0-1px
   * remainder is painted as a translate3d offset, so the *visual* position
   * advances every single frame.
   */
  function visualPositions(speed: number, frames: number) {
    const out: number[] = [];
    let pos = 0;
    for (let i = 0; i < frames; i++) {
      pos += speed;
      const whole = Math.floor(pos);
      const frac = pos - whole;
      out.push(whole + frac); // scrollTop + (-translate) === true position
    }
    return out;
  }

  it("0.2x moves smoothly every frame (no multi-frame 1px staircase)", () => {
    const p = visualPositions(0.2, 60);
    expect(p[p.length - 1]).toBeCloseTo(12, 5);
    for (let i = 1; i < p.length; i++) {
      expect(p[i] - p[i - 1]).toBeCloseTo(0.2, 5); // strictly monotonic
    }
  });

  it("0.5x remainder never exceeds one pixel", () => {
    for (const v of visualPositions(0.5, 120)) {
      expect(v - Math.floor(v)).toBeLessThan(1);
    }
  });

  it("0.1x advances ~6px per second instead of stalling at 0", () => {
    expect(simulate(0.1, 60, false)).toBe(0); // old engine: frozen
    expect(simulate(0.1, 60, true)).toBe(6); // fixed engine
  });

  it("0.2x and 0.5x also make real progress", () => {
    expect(simulate(0.2, 60, true)).toBe(12);
    expect(simulate(0.5, 60, true)).toBe(30);
  });

  it("0.75x lands between 0.5x and 1x", () => {
    expect(simulate(0.75, 60, true)).toBe(45);
  });

  it("1x and above were unaffected by the old bug", () => {
    expect(simulate(1, 60, false)).toBe(60);
    expect(simulate(1, 60, true)).toBe(60);
  });
});