import { useEffect, useState, forwardRef, type ComponentType, type ReactNode } from "react";
import { reportError } from "../lib/sentry";

type ProviderProps = { children: ReactNode; delayDuration?: number };


/**
 * Lazy-mounts @radix-ui/react-tooltip's Provider after first paint.
 * Tooltip.Root has its own internal provider fallback, so rendering
 * children without the explicit Provider for a few frames is safe —
 * the only cost is that tooltips triggered in the first ~100ms use
 * default delay timings. This keeps @floating-ui out of the initial
 * entry bundle.
 */
export const LazyTooltipProvider = forwardRef<unknown, ProviderProps>(function LazyTooltipProvider(
  { children, delayDuration },
  _ref,
) {
  const [Provider, setProvider] = useState<ComponentType<ProviderProps> | null>(null);


  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 3;
    const load = () => {
      if (cancelled) return;
      import("@radix-ui/react-tooltip")
        .then((mod) => {
          if (!cancelled) setProvider(() => mod.Provider as ComponentType<ProviderProps>);
        })
        .catch((err) => {
          // Vite dep cache invalidation / transient network drop can 404 the
          // optimized dep module. Retry a few times before giving up — tooltips
          // are non-critical, children render fine without the Provider.
          if (!cancelled && attempts < MAX_ATTEMPTS) {
            attempts += 1;
            setTimeout(load, 400 * attempts);
          } else if (!cancelled) {
            // Final failure — report so Sentry/monitoring knows the dep is
            // genuinely broken, not just a transient cache miss.
            reportError(err, { tag: "lazy-tooltip-provider", hint: "radix-tooltip import failed after retries" });
          }
        });
    };
    const w = window as unknown as { requestIdleCallback?: (cb: () => void) => number };
    if (typeof w.requestIdleCallback === "function") {
      w.requestIdleCallback(load);
    } else {
      setTimeout(load, 200);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Provider) return <>{children}</>;
  return <Provider delayDuration={delayDuration}>{children}</Provider>;
});


export default LazyTooltipProvider;