import { describe, it, expect, afterEach } from "vitest";
import {
  ROTATION_FRAME_ATTR,
  rotationFrameStyle,
  resolveReaderPortalHost,
} from "@/lib/rotationFrame";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("rotationFrameStyle", () => {
  it("is a no-op when the real orientation lock worked", () => {
    expect(rotationFrameStyle(false)).toBeUndefined();
  });

  it("rotates about the top-left corner with swapped viewport axes", () => {
    const s = rotationFrameStyle(true)!;
    expect(s.transform).toBe("rotate(90deg) translateY(-100%)");
    expect(s.transformOrigin).toBe("top left");
    expect(s.width).toBe("100dvh");
    expect(s.height).toBe("100dvw");
    expect(s.position).toBe("absolute");
  });

  it("moves the notch inset to the left edge", () => {
    const s = rotationFrameStyle(true)!;
    expect(s.paddingLeft).toContain("safe-area-inset-top");
    expect(s.paddingTop).toBeUndefined();
  });
});

describe("resolveReaderPortalHost", () => {
  it("falls back to body when nothing special is mounted", () => {
    expect(resolveReaderPortalHost(document)).toBe(document.body);
  });

  it("prefers the rotation frame so floating UI rotates with the page", () => {
    const frame = document.createElement("div");
    frame.setAttribute(ROTATION_FRAME_ATTR, "true");
    document.body.appendChild(frame);
    expect(resolveReaderPortalHost(document)).toBe(frame);
  });
});
