/**
 * BrandMark — real NB logo served from /brand/nb-mark.webp (~7KB webp).
 * The asset is bundled into the app shell (Capacitor ships it as a local
 * file under the WebView origin), so the network cost is effectively zero
 * while keeping the JS initial-entry chunk lean — the previous inline
 * data URL added ~6–7KB of base64 to every cold start.
 */
import { forwardRef, memo } from "react";

const NB_MARK_SRC = "/brand/nb-mark.webp";

interface BrandMarkProps {
  className?: string;
  size?: number;
  decorative?: boolean;
  title?: string;
}

// forwardRef: dev tooling (and any parent that wants the <img> node) passes a
// ref down to this component. Without forwardRef React floods the console with
// "Function components cannot be given refs", burying real errors during triage.
const BrandMarkInner = forwardRef<HTMLImageElement, BrandMarkProps>(({
  className,
  size = 64,
  decorative = false,
  title = "Naveen Bharat",
}, ref) => (
  <img
    ref={ref}
    src={NB_MARK_SRC}
    width={size}
    height={size}
    alt={decorative ? "" : title}
    aria-hidden={decorative || undefined}
    className={className}
    draggable={false}
    decoding="async"
    {...({ fetchpriority: "high" } as Record<string, string>)}
    style={{ objectFit: "contain" }}
  />
));
BrandMarkInner.displayName = "BrandMark";

export const BrandMark = memo(BrandMarkInner);
export default BrandMark;
