import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import AutoScrollFab from "../components/viewer/AutoScrollFab";

const dwellState = {
  enabled: true,
  parity: "all" as const,
  seconds: 10,
  pages: [] as number[],
  route: [] as number[],
  loopRoute: false,
  a4: false,
};

const setDwellSpy = vi.fn();

vi.mock("../hooks/useAutoScroll", () => ({
  useAutoScroll: () => ({
    active: false,
    speed: 1,
    setSpeed: vi.fn(),
    toggle: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    reverse: false,
    setReverse: vi.fn(),
    dwell: dwellState,
    setDwell: setDwellSpy,
    scrollToTop: vi.fn(),
  }),
}));


afterEach(() => {
  cleanup();
  delete document.body.dataset.lovableDialogOpen;
  document.body.innerHTML = "";
});

describe("AutoScrollFab", () => {
  it("portals to body and avoids the generic floating-fab dialog hide selector", () => {
    document.body.dataset.lovableDialogOpen = "true";
    render(<AutoScrollFab bottomOffset={96} />);

    const button = screen.getByRole("button", { name: /start autoscroll/i });
    expect(button.parentElement).toBe(document.body);
    expect(button).toHaveAttribute("data-autoscroll-fab", "true");
    expect(button).not.toHaveAttribute("data-floating-fab");
    expect(button).toHaveStyle({ bottom: "calc(96px + env(safe-area-inset-bottom, 0px))" });
  });

  it("can be visually hidden by reader chrome without unmounting", () => {
    render(<AutoScrollFab visible={false} />);

    const button = screen.getByRole("button", { name: /start autoscroll/i });
    expect(button).toHaveClass("opacity-0");
    expect(button).toHaveClass("pointer-events-none");
  });
});
// The settings sheet is lazy-loaded, so the long-press needs fake timers while
// the dynamic import needs real ones. Press with fake timers, then restore.
async function openSheet() {
  const { act, fireEvent } = await import("@testing-library/react");
  vi.useFakeTimers();
  render(<AutoScrollFab />);
  const fab = screen.getByRole("button", { name: /start autoscroll/i });
  act(() => {
    fireEvent.pointerDown(fab, { clientX: 0, clientY: 0, pointerId: 1 });
    vi.advanceTimersByTime(320);
  });
  vi.useRealTimers();
  await screen.findByRole("dialog", { name: /autoscroll speed/i });
  return { act, fireEvent };
}

describe("AutoScrollFab settings sheet", () => {
  it("renders every Pause-at chip in a wrap-safe grid (no overlapping labels)", async () => {
    await openSheet();

    for (const label of ["Odd", "Even", "Every page", "Custom", "Route"]) {
      const chip = screen.getByRole("button", { name: label });
      expect(chip.className).toContain("min-w-0");
      expect(chip.parentElement?.className).toContain("grid-cols-3");
    }
  });

  it("still renders every chip group after the sheet was split out", async () => {
    await openSheet();

    // speed presets (incl. the 20x skim chip), pause-at parities, pause-for durations
    expect(screen.getByRole("button", { name: "20x" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "0.02x" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Every page" })).toBeInTheDocument();
    for (const s of ["10s", "20s", "30s", "60s"]) {
      expect(screen.getByRole("button", { name: s })).toBeInTheDocument();
    }
    expect(screen.getByRole("dialog", { name: /autoscroll speed/i })).toBeInTheDocument();
  });
});

describe("A4 Sheet toggle", () => {
  it("shows the toggle off by default and turns it on with one tap", async () => {
    const { act, fireEvent } = await openSheet();

    const toggle = screen.getByRole("button", { name: /A4 Sheet/i });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    setDwellSpy.mockClear();
    act(() => { fireEvent.click(toggle); });
    expect(setDwellSpy).toHaveBeenCalledWith({ a4: true });
  });
});

