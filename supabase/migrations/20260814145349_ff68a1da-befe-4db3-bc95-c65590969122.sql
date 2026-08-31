GRANT EXECUTE ON FUNCTION public.get_course_lesson_stats() TO anon;
GRANT EXECUTE ON FUNCTION public.get_course_bundle(bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.search_lectures(text, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.user_can_access_live_session_topic(text) TO anon;