/**
 * Narrow an unknown thrown value to a human-readable message.
 * Use in `catch (err: unknown)` instead of annotating the error as `any`.
 */
export function getErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (typeof err === "string") return err || fallback;
  if (err instanceof Error) return err.message || fallback;
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}
