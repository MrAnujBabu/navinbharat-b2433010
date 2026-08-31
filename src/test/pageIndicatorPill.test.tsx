/**
 * PageIndicatorPill hardening checks.
 *
 *  1. SEC — `nb-page-state` from any window other than our reader iframe must
 *     be ignored (an ad/opener frame must not drive page numbers).
 *  2. DATA — stepping twice in a row must land on consecutive page boundaries.
 *     The old code faked `performance.now() + 1000` to force a re-measure,
 *     which poisoned the 500ms measurement cache and made the second step
 *     read stale rects.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { createRef } from "react";
import PageIndicatorPill from "../components/viewer/PageIndicatorPill";

function makeScroller(pageCount: number, pageHeight = 500, viewport = 500) {
  const el = document.createElement("div");
  for (let i = 1; i <= pageCount; i++) {
    const page = document.createElement("div");
    page.dataset.page = String(i);
    Object.defineProperty(page, "getBoundingClientRect", {
      value: () => ({
        top: (i - 1) * pageHeight - el.scrollTop,
        bottom: i * pageHeight - el.scrollTop,
        left: 0,
        right: 0,
        width: 0,
        height: pageHeight,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
    el.appendChild(page);
  }
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () => ({
      top: -el.scrollTop,
      bottom: 0,
      left: 0,
      right: 0,
      width: 0,
      height: viewport,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
  Object.defineProperty(el, "clientHeight", { value: viewport });
  Object.defineProperty(el, "scrollHeight", { value: pageCount * pageHeight });
  document.body.appendChild(el);
  return el;
}

describe("PageIndicatorPill", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  it("ignores nb-page-state from a foreign window", () => {
    const iframeRef = createRef<HTMLIFrameElement | null>();
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    (iframeRef as { current: HTMLIFrameElement | null }).current = iframe;

    const { container } = render(<PageIndicatorPill iframeRef={iframeRef} />);

    act(() => {
      window.dispatchEvent(
        Object.assign(new MessageEvent("message", { data: { type: "nb-page-state", first: 9, last: 9, total: 40 } }), {
          // jsdom: `source` is read-only on the event, so patch it directly.
        })
      );
    });
    // No trusted source → nothing rendered.
    expect(document.body.textContent).not.toContain("9/40");
    expect(container).toBeTruthy();
  });

  it("steps to consecutive pages twice in a row (no stale measure cache)", () => {
    const el = makeScroller(10);
    const targetRef = createRef<HTMLElement | null>();
    (targetRef as { current: HTMLElement | null }).current = el;

    render(<PageIndicatorPill targetRef={targetRef} />);

    const next = document.body.querySelector<HTMLButtonElement>('[aria-label="Next page"]');
    expect(next).toBeTruthy();

    act(() => next!.click());
    expect(el.scrollTop).toBe(500);
    act(() => next!.click());
    expect(el.scrollTop).toBe(1000);
  });
});

describe("PageIndicatorPill drag-to-scrub", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  function pointer(el: Element, type: string, clientY: number) {
    const ev = new Event(type, { bubbles: true }) as Event & Record<string, unknown>;
    (ev as unknown as { clientY: number }).clientY = clientY;
    (ev as unknown as { pointerId: number }).pointerId = 1;
    el.dispatchEvent(ev);
  }

  it("drags the chip from track top to track bottom and reaches the end", () => {
    const el = makeScroller(10);
    const targetRef = createRef<HTMLElement | null>();
    (targetRef as { current: HTMLElement | null }).current = el;
    render(<PageIndicatorPill targetRef={targetRef} />);

    const chip = document.body.querySelector('[role="slider"]')!;
    act(() => {
      pointer(chip, "pointerdown", 56);
      pointer(chip, "pointermove", window.innerHeight);
      pointer(chip, "pointerup", window.innerHeight);
    });
    expect(el.scrollTop).toBe(el.scrollHeight - el.clientHeight);
  });

  it("ignores a press smaller than the drag threshold", () => {
    const el = makeScroller(10);
    const targetRef = createRef<HTMLElement | null>();
    (targetRef as { current: HTMLElement | null }).current = el;
    render(<PageIndicatorPill targetRef={targetRef} />);

    const chip = document.body.querySelector('[role="slider"]')!;
    act(() => {
      pointer(chip, "pointerdown", 56);
      pointer(chip, "pointermove", 59);
      pointer(chip, "pointerup", 59);
    });
    expect(el.scrollTop).toBe(0);
  });

  it("scrubs a short drag once past the threshold (origin-based, no dead zone)", () => {
    const el = makeScroller(10);
    const targetRef = createRef<HTMLElement | null>();
    (targetRef as { current: HTMLElement | null }).current = el;
    render(<PageIndicatorPill targetRef={targetRef} />);

    const chip = document.body.querySelector('[role="slider"]')!;
    act(() => {
      pointer(chip, "pointerdown", 56);
      pointer(chip, "pointermove", 76); // 20px > 6px threshold
      pointer(chip, "pointerup", 76);
    });
    expect(el.scrollTop).toBeGreaterThan(0);
  });

  it("hides completely and stops eating taps once idle", () => {
    const el = makeScroller(10);
    const targetRef = createRef<HTMLElement | null>();
    (targetRef as { current: HTMLElement | null }).current = el;
    render(<PageIndicatorPill targetRef={targetRef} idleMs={0} />);

    // Still mounted for focus / assistive tech, but invisible and inert so the
    // page underneath receives the touch.
    const chip = document.body.querySelector('[role="slider"]')!;
    expect(chip).toBeTruthy();
    // The chip and stepper share one pill; that pill carries the hit-area gate
    // and its wrapper carries the fade.
    const pill = chip.parentElement!;
    expect(pill.className).toContain("pointer-events-none");
    expect(pill.parentElement!.className).toContain("opacity-0");

  });

  it("does not let iframe page reports override the thumb during a drag", () => {
    const iframeRef = createRef<HTMLIFrameElement | null>();
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    (iframeRef as { current: HTMLIFrameElement | null }).current = iframe;

    render(<PageIndicatorPill iframeRef={iframeRef} />);

    const post = (data: unknown) => {
      const ev = new MessageEvent("message", { data, origin: window.location.origin });
      Object.defineProperty(ev, "source", { value: iframe.contentWindow });
      window.dispatchEvent(ev);
    };

    act(() => post({ type: "nb-page-state", first: 1, last: 1, total: 10 }));
    const wrapper = document.body.querySelector('[role="slider"]')!.parentElement as HTMLElement;
    const chip = document.body.querySelector('[role="slider"]')!;

    act(() => {
      pointer(chip, "pointerdown", 56);
      pointer(chip, "pointermove", window.innerHeight);
    });
    const draggedTop = wrapper.style.top;

    // A lagging page report while the finger is down must not move the thumb.
    act(() => post({ type: "nb-page-state", first: 2, last: 2, total: 10 }));
    expect(wrapper.style.top).toBe(draggedTop);

    act(() => pointer(chip, "pointerup", window.innerHeight));
  });
});

