-- Revoke blanket PUBLIC execute, then re-grant only where needed.
REVOKE ALL ON FUNCTION public.get_course_bundle(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_bundle(bigint) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_course_lesson_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_lesson_stats() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_platform_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_platform_stats() TO service_role;

REVOKE ALL ON FUNCTION public.search_lectures(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_lectures(text, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.user_can_access_live_session_topic(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_access_live_session_topic(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.purge_expired_phone_otps() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_phone_otps() TO service_role;

REVOKE ALL ON FUNCTION public.check_rate_limit(text, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, uuid, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.check_rate_limit_text(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit_text(text, text, integer, integer) TO service_role;