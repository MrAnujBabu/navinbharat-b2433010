-- 1) Community content: hide moderated content from ordinary users
DROP POLICY IF EXISTS "Authenticated users view posts" ON public.community_posts;
CREATE POLICY "Authenticated users view visible posts"
ON public.community_posts FOR SELECT TO authenticated
USING (COALESCE(is_hidden, false) = false OR public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Authenticated users view comments" ON public.community_comments;
CREATE POLICY "Authenticated users view visible comments"
ON public.community_comments FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR (
    COALESCE(is_hidden, false) = false
    AND EXISTS (
      SELECT 1 FROM public.community_posts p
      WHERE p.id = community_comments.post_id AND COALESCE(p.is_hidden, false) = false
    )
  )
);

DROP POLICY IF EXISTS "Authenticated users view reactions" ON public.community_reactions;
CREATE POLICY "Authenticated users view reactions on visible posts"
ON public.community_reactions FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.community_posts p
    WHERE p.id = community_reactions.post_id AND COALESCE(p.is_hidden, false) = false
  )
);

REVOKE SELECT ON public.community_posts FROM anon;
REVOKE SELECT ON public.community_comments FROM anon;
REVOKE SELECT ON public.community_reactions FROM anon;

-- 2) lesson_likes: own likes only (counts come from lessons.like_count)
DROP POLICY IF EXISTS "Anyone authenticated can view likes" ON public.lesson_likes;
REVOKE SELECT ON public.lesson_likes FROM anon;

-- 3) phone_otps: server-side only
REVOKE ALL ON public.phone_otps FROM anon;
REVOKE ALL ON public.phone_otps FROM authenticated;
GRANT ALL ON public.phone_otps TO service_role;

-- 4) No SECURITY DEFINER helper is callable by signed-out visitors
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_course_bundle(bigint) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_course_lesson_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_can_access_live_session_topic(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.search_lectures(text, integer) FROM anon;

-- 5) Definer helpers only used by server-side code: drop client EXECUTE
REVOKE EXECUTE ON FUNCTION public.match_knowledge(extensions.vector, double precision, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_enrollment_for_attendance(bigint, uuid) FROM anon, authenticated;