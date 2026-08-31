/**
 * Page-slider chip (`2/7`) logic regression tests.
 *
 * Covers what the first suite did not: label formatting, the hide rule for
 * single-page docs, thumb position math, the tap-vs-scrub threshold, and the
 * "don't fight the finger" scrub window when the pdf.js iframe reports late.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
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

function renderPill(el: HTMLElement | null) {
  const ref = createRef<HTMLElement>();
  (ref as { current: HTMLElement | null }).current = el;
  const utils = render(<PageIndicatorPill targetRef={ref} />);
  return utils;
}

describe("PageIndicatorPill — slider chip logic", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders nothing for a single-page document", () => {
    const el = makeScroller(1);
    const { queryByRole } = renderPill(el);
    expect(queryByRole("slider")).toBeNull();
  });

  it("shows `1/7` at the top of a 7-page document", () => {
    const el = makeScroller(7);
    const { getByRole } = renderPill(el);
    const slider = getByRole("slider");
    expect(slider.getAttribute("aria-valuetext")).toBe("1/7");
    expect(slider.getAttribute("aria-valuemax")).toBe("7");
    expect(slider.getAttribute("aria-valuenow")).toBe("1");
  });

  it("reports the last page after scrolling to the end", () => {
    const el = makeScroller(7);
    const { getByRole } = renderPill(el);
    act(() => {
      el.scrollTop = 7 * 500 - 500;
      el.dispatchEvent(new Event("scroll"));
    });
    expect(getByRole("slider").getAttribute("aria-valuetext")).toBe("7/7");
  });

  it("treats a sub-threshold wobble as a tap (no scroll change)", () => {
    const el = makeScroller(7);
    const { getByRole } = renderPill(el);
    const slider = getByRole("slider");
    const before = el.scrollTop;
    fireEvent.pointerDown(slider, { pointerId: 1, clientY: 300 });
    fireEvent.pointerMove(slider, { pointerId: 1, clientY: 303 });
    fireEvent.pointerUp(slider, { pointerId: 1, clientY: 303 });
    expect(el.scrollTop).toBe(before);
  });

  it("scrubs the document when the drag passes the threshold", () => {
    const el = makeScroller(7);
    const { getByRole } = renderPill(el);
    const slider = getByRole("slider");
    fireEvent.pointerDown(slider, { pointerId: 1, clientY: 120 });
    act(() => {
      fireEvent.pointerMove(slider, { pointerId: 1, clientY: 600 });
    });
    expect(el.scrollTop).toBeGreaterThan(0);
    const max = el.scrollHeight - el.clientHeight;
    expect(el.scrollTop).toBeLessThanOrEqual(max);
    fireEvent.pointerUp(slider, { pointerId: 1, clientY: 600 });
  });

  it("ignores a late iframe page report while the finger owns the thumb", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const ref = createRef<HTMLIFrameElement>();
    (ref as { current: HTMLIFrameElement | null }).current = iframe;
    const { getByRole } = render(<PageIndicatorPill iframeRef={ref} />);

    const post = (data: unknown) =>
      act(() => {
        const ev = new MessageEvent("message", { data, origin: window.location.origin });
        Object.defineProperty(ev, "source", { value: iframe.contentWindow });
        window.dispatchEvent(ev);
      });

    post({ type: "nb-page-state", first: 1, last: 1, total: 10 });
    const slider = getByRole("slider");
    const top = () => (slider.parentElement as HTMLElement).style.top;

    fireEvent.pointerDown(slider, { pointerId: 1, clientY: 120 });
    act(() => {
      fireEvent.pointerMove(slider, { pointerId: 1, clientY: 500 });
    });
    const dragged = top();
    // A stale report for page 1 must not snap the thumb back to the top.
    post({ type: "nb-page-state", first: 1, last: 1, total: 10 });
    expect(top()).toBe(dragged);
    fireEvent.pointerUp(slider, { pointerId: 1, clientY: 500 });
  });

  it("drives the iframe reader with nb-goto-page from the chevrons", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const ref = createRef<HTMLIFrameElement>();
    (ref as { current: HTMLIFrameElement | null }).current = iframe;
    const posted: unknown[] = [];
    const win = iframe.contentWindow as Window;
    vi.spyOn(win, "postMessage").mockImplementation((msg: unknown) => {
      posted.push(msg);
    });
    const { getByLabelText } = render(<PageIndicatorPill iframeRef={ref} />);
    act(() => {
      const ev = new MessageEvent("message", {
        origin: window.location.origin,
        data: { type: "nb-page-state", first: 3, last: 3, total: 9 },
      });
      Object.defineProperty(ev, "source", { value: win });
      window.dispatchEvent(ev);
    });
    fireEvent.click(getByLabelText("Next page"));
    expect(posted).toContainEqual({ type: "nb-goto-page", delta: 1 });
    fireEvent.click(getByLabelText("Previous page"));
    expect(posted).toContainEqual({ type: "nb-goto-page", delta: -1 });
  });
});
