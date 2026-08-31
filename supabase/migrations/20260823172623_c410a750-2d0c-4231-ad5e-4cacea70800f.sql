-- Reduce SECURITY DEFINER surface: these two read-only helpers do not need to
-- bypass row-level security; the underlying lessons policies already scope
-- access to enrolled users and staff.
CREATE OR REPLACE FUNCTION public.get_course_lesson_stats()
 RETURNS TABLE(course_id bigint, lesson_count bigint, total_duration bigint)
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  SELECT l.course_id, COUNT(*)::bigint AS lesson_count, COALESCE(SUM(l.duration),0)::bigint AS total_duration
  FROM public.lessons l
  WHERE l.course_id IS NOT NULL AND auth.uid() IS NOT NULL
  GROUP BY l.course_id
$function$;

CREATE OR REPLACE FUNCTION public.search_lectures(_query text, _limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, title text, description text, course_id bigint, chapter_id uuid, lecture_type text, thumbnail_url text, rank real)
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT l.id, l.title, l.description, l.course_id, l.chapter_id, l.lecture_type, l.thumbnail_url,
    GREATEST(similarity(l.title,_query), similarity(COALESCE(l.description,''),_query)*0.6) AS rank
  FROM public.lessons l
  WHERE auth.uid() IS NOT NULL
    AND (l.is_locked IS DISTINCT FROM TRUE)
    AND (l.title ILIKE '%'||_query||'%' OR l.description ILIKE '%'||_query||'%' OR similarity(l.title,_query) > 0.2)
  ORDER BY rank DESC, l.created_at DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(_limit, 50));
$function$;

-- Keep execute rights tight on everything that must stay SECURITY DEFINER.
REVOKE ALL ON FUNCTION public.get_course_lesson_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_lesson_stats() TO authenticated;
REVOKE ALL ON FUNCTION public.search_lectures(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_lectures(text, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_get_batch_roster(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_suspicious_enrollments(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_user_snapshot(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_hide_content(text, uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_mark_enrollment_legit(bigint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_resolve_report(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revoke_enrollment(bigint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_user_block(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_course_bundle(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_dashboard_snapshot() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_quiz_questions(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_quiz_review(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_user_role(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_get_batch_roster(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_suspicious_enrollments(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_user_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_hide_content(text, uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_enrollment_legit(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_report(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_enrollment(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_block(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_bundle(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_snapshot() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_quiz_questions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_quiz_review(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;