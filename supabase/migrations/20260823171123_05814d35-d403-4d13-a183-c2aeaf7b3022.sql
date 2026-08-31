-- 1. Hide moderated comments from regular viewers
DROP POLICY IF EXISTS "Enrolled users and staff can view comments" ON public.comments;
CREATE POLICY "Enrolled users and staff can view comments"
ON public.comments
FOR SELECT
USING (
  (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'teacher'::app_role)
    OR (EXISTS (
      SELECT 1 FROM lessons l
      JOIN enrollments e ON e.course_id = l.course_id AND e.user_id = auth.uid() AND e.status = 'active'
      WHERE l.id = comments.lesson_id))
    OR (EXISTS (
      SELECT 1 FROM lessons l
      JOIN courses c ON c.id = l.course_id
      WHERE l.id = comments.lesson_id AND (c.price IS NULL OR c.price = 0)))
  )
  AND (
    is_hidden IS NOT TRUE
    OR user_id = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
  )
);

-- 2. Hide moderated doubt replies from session participants
DROP POLICY IF EXISTS "Users can read replies for their sessions" ON public.doubt_replies;
CREATE POLICY "Users can read replies for their sessions"
ON public.doubt_replies
FOR SELECT
USING (
  (
    user_id = auth.uid()
    OR (EXISTS (
      SELECT 1 FROM doubt_sessions ds
      WHERE ds.id = doubt_replies.doubt_session_id
        AND (ds.student_id = auth.uid() OR ds.teacher_id = auth.uid())))
    OR has_role(auth.uid(), 'admin'::app_role)
  )
  AND (
    is_hidden IS NOT TRUE
    OR user_id = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
  )
);

-- 3. Tighten SECURITY DEFINER function exposure
-- Never callable anonymously or by PUBLIC
REVOKE ALL ON FUNCTION public.admin_get_batch_roster(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_suspicious_enrollments(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_user_snapshot(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_hide_content(text, uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_mark_enrollment_legit(bigint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_resolve_report(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revoke_enrollment(bigint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_user_block(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_user_profiles_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_dashboard_snapshot() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_course_bundle(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_quiz_questions(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_quiz_review(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_user_role(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.search_lectures(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_course_lesson_stats() FROM PUBLIC, anon;

-- Admin-only reporting helper: drop the blanket signed-in EXECUTE grant,
-- it is reachable through the admin-guarded functions instead.
REVOKE EXECUTE ON FUNCTION public.get_user_profiles_admin() FROM authenticated;

-- Functions that were missing an explicit authentication guard
CREATE OR REPLACE FUNCTION public.get_course_lesson_stats()
 RETURNS TABLE(course_id bigint, lesson_count bigint, total_duration bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
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
 STABLE SECURITY DEFINER
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

REVOKE ALL ON FUNCTION public.get_course_lesson_stats() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.search_lectures(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_lesson_stats() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_lectures(text, integer) TO authenticated, service_role;