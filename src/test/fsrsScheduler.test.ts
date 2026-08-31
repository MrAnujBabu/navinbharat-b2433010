/**
 * Shuffle (FSRS) scheduler contract.
 *
 *  1. ALGO — a forgotten page must outrank a freshly reviewed one.
 *  2. ALGO — "Again" must shrink stability, "Easy" must grow it.
 *  3. UX   — implicit grading maps dwell ratio to the right Anki button.
 *  4. RELY — the route respects the page range and the length cap, and is
 *            deterministic for a given seed (so a session order is stable).
 */

import { describe, it, expect } from "vitest";
import {
  buildShuffleRoute,
  deckStats,
  forecastDue,
  inferGrade,
  newCard,
  retrievability,
  reviewCard,
  type PageCard,
} from "../lib/reader/fsrsScheduler";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

const seen = (page: number, daysAgo: number, stability: number): PageCard => ({
  ...newCard(page),
  difficulty: 5,
  stability,
  lastReviewedAt: NOW - daysAgo * DAY,
  reps: 1,
});

describe("fsrs scheduler", () => {
  it("ranks a forgotten page ahead of a fresh one", () => {
    const forgotten = seen(2, 30, 1);
    const fresh = seen(3, 0, 10);
    expect(retrievability(forgotten, NOW)).toBeLessThan(retrievability(fresh, NOW));
  });

  it("shrinks stability on Again and grows it on Easy", () => {
    const card = seen(1, 5, 10);
    expect(reviewCard(card, 1, NOW).stability).toBeLessThanOrEqual(card.stability);
    expect(reviewCard(card, 4, NOW).stability).toBeGreaterThan(card.stability);
  });

  it("infers grades from dwell ratio", () => {
    expect(inferGrade(2.5)).toBe(1); // lingered → Again
    expect(inferGrade(1.5)).toBe(2);
    expect(inferGrade(1)).toBe(3);
    expect(inferGrade(0.2)).toBe(4); // skimmed → Easy
    expect(inferGrade(0.2, true)).toBe(1); // revisit always Again
  });

  it("puts due pages before new ones", () => {
    const cards = [seen(5, 60, 1), seen(6, 0, 100)];
    const route = buildShuffleRoute(cards, 8, { now: NOW, seed: 7 });
    expect(route[0]).toBe(5);
    expect(route.indexOf(6)).toBeGreaterThan(route.indexOf(1));
  });

  it("respects the page range and the length cap", () => {
    const route = buildShuffleRoute([], 1000, { from: 10, to: 20, now: NOW, limit: 5 });
    expect(route).toHaveLength(5);
    expect(Math.min(...route)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...route)).toBeLessThanOrEqual(20);
  });

  it("is deterministic for one seed", () => {
    const cards = [seen(1, 40, 2), seen(2, 30, 2), seen(3, 20, 2)];
    const a = buildShuffleRoute(cards, 3, { seed: 42, now: NOW });
    const b = buildShuffleRoute(cards, 3, { seed: 42, now: NOW });
    expect(a).toEqual(b);
  });

  it("summarises the deck for the settings sheet", () => {
    const stats = deckStats([seen(1, 60, 1), seen(2, 0, 50)], 4, { now: NOW });
    expect(stats.total).toBe(4);
    expect(stats.fresh).toBe(2);
    expect(stats.due).toBe(1);
    expect(stats.avgRecall).not.toBeNull();
  });
});

describe("advanced shuffle options", () => {
  const now = Date.UTC(2026, 0, 10);
  /** A page reviewed long ago (due) vs. a leech reviewed long ago. */
  const seen = (page: number, lapses = 0): PageCard => ({
    page,
    difficulty: 5,
    stability: 1,
    lastReviewedAt: now - 30 * 86_400_000,
    reps: 3,
    lapses,
  });

  it("weaves new pages into the due stream at the requested mix", () => {
    const cards = [seen(1), seen(2), seen(3), seen(4)];
    const route = buildShuffleRoute(cards, 8, { now, newMix: 0.5, seed: 7 });
    const firstFour = route.slice(0, 4);
    // With a 50% mix at least one unseen page (5..8) shows up early.
    expect(firstFour.some((p) => p > 4)).toBe(true);
    expect(new Set(route).size).toBe(route.length);
  });

  it("keeps all revision first when newMix is 0", () => {
    const cards = [seen(1), seen(2)];
    const route = buildShuffleRoute(cards, 6, { now, newMix: 0, seed: 7 });
    expect(route.slice(0, 2).sort()).toEqual([1, 2]);
  });

  it("pulls leeches to the front", () => {
    const cards = [seen(1), seen(2), seen(3, 9)];
    const route = buildShuffleRoute(cards, 3, { now, leechThreshold: 8, seed: 3 });
    expect(route[0]).toBe(3);
  });

  it("caps the session when sessionLimit is set", () => {
    const route = buildShuffleRoute([], 40, { now, sessionLimit: 5 });
    expect(route).toHaveLength(5);
  });

  it("a lower retention target leaves fewer pages due", () => {
    const cards = [seen(1), seen(2), seen(3)];
    const strict = deckStats(cards, 3, { now, retention: 0.97 });
    const relaxed = deckStats(cards, 3, { now, retention: 0.7 });
    expect(strict.due).toBeGreaterThanOrEqual(relaxed.due);
    expect(deckStats(cards, 3, { now }).leeches).toBe(0);
  });

  it("forecasts a bounded per-day due load", () => {
    const f = forecastDue([seen(1), seen(2)], 2, 7, { now });
    expect(f).toHaveLength(7);
    expect(f.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(2);
  });
});
