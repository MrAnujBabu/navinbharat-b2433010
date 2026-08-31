import { supabase } from "@/integrations/supabase/client";

/**
 * Fire-and-forget security event logger.
 *
 * Writes go through the `log-security-event` edge function, which verifies the
 * JWT, derives `user_id` from the token, allowlists the event type and clamps
 * the payload. Direct client INSERTs into `public.security_events` are denied
 * by RLS so the audit surface cannot be forged from the browser.
 *
 * Never throws — security logging must not break the user experience.
 *
 * Phone numbers MUST be masked before being passed in via `payload`.
 */
export async function logSecurityEvent(
  eventType: string,
  payload: Record<string, unknown> = {}
): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return; // Anonymous events are not recorded.
    await supabase.functions.invoke("log-security-event", {
      body: { event_type: eventType, payload },
    });
  } catch (err) {
    if (typeof console !== "undefined") {
      console.debug("[logSecurityEvent] swallowed", err);
    }
  }
}
