-- 1. audit_log: remove client-side INSERT (forged audit trails)
DROP POLICY IF EXISTS "System can insert audit logs" ON public.audit_log;
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM authenticated;
REVOKE ALL ON public.audit_log FROM anon;
GRANT ALL ON public.audit_log TO service_role;

-- 2. security_events: remove client-side INSERT (forged security events).
--    Writes now go through the `log-security-event` edge function.
DROP POLICY IF EXISTS "own events insert" ON public.security_events;
REVOKE INSERT, UPDATE, DELETE ON public.security_events FROM authenticated;
REVOKE ALL ON public.security_events FROM anon;
GRANT ALL ON public.security_events TO service_role;

-- 3. messages: drop the broad policy that let recipients rewrite content.
DROP POLICY IF EXISTS "Users can update their sent messages" ON public.messages;
-- Remaining UPDATE policies:
--   * "Senders can update their sent messages"        (sender_id = auth.uid())
--   * "Recipients can mark received messages as read" (recipient_id = auth.uid(),
--     column-restricted by trigger enforce_message_recipient_readonly)

-- 4. Tighten SECURITY DEFINER function exposure: nothing should be callable
--    by PUBLIC or by signed-out visitors. Admin/user RPCs keep their explicit
--    `authenticated` grant and enforce has_role()/auth.uid() internally.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
  END LOOP;
END $$;

-- RLS policies and realtime checks evaluate as the calling role, so these
-- helper predicates must stay executable.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_live_session_topic(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.storage_url_matches_object(text, text) TO authenticated, anon;