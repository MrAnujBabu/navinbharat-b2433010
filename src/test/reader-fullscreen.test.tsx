import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";

vi.mock("@/lib/platform", () => ({ isNative: () => true }));
vi.mock("@/lib/crashShield", () => ({ suppressCrashShield: vi.fn() }));

import { useReaderFullscreen } from "@/hooks/useReaderFullscreen";

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggleFullscreen } = useReaderFullscreen(ref);
  return (
    <div ref={ref}>
      <span>{isFullscreen ? "full" : "normal"}</span>
      <button onClick={() => void toggleFullscreen()}>toggle</button>
    </div>
  );
}

describe("native PDF fullscreen state machine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("changes only React chrome state and never invokes browser fullscreen", () => {
    const requestFullscreen = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByText("full")).toBeInTheDocument();
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it("collapses rapid repeated taps into one transition", () => {
    render(<Harness />);
    const button = screen.getByRole("button", { name: "toggle" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.getByText("full")).toBeInTheDocument();

    vi.advanceTimersByTime(400);
    fireEvent.click(button);
    expect(screen.getByText("normal")).toBeInTheDocument();
  });
});