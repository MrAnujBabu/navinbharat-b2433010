-- 1. Chatbot moderation
CREATE POLICY "Admins can update chatbot logs"
ON public.chatbot_logs FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete chatbot logs"
ON public.chatbot_logs FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update chatbot feedback"
ON public.chatbot_feedback FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete chatbot feedback"
ON public.chatbot_feedback FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- 2. Exact (non-wildcard) storage URL matcher
CREATE OR REPLACE FUNCTION public.storage_url_matches_object(_url text, _object_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _url IS NULL OR _object_name IS NULL THEN false
    ELSE (
      split_part(_url, '?', 1) = 'storage://content/' || _object_name
      OR right(split_part(_url, '?', 1), length('/content/' || _object_name)) = '/content/' || _object_name
    )
  END
$$;

REVOKE ALL ON FUNCTION public.storage_url_matches_object(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_url_matches_object(text, text) TO authenticated, service_role;

-- 3. Rebuild gated content policy with strict matching
DROP POLICY IF EXISTS "Enrolled users can read gated content" ON storage.objects;
CREATE POLICY "Enrolled users can read gated content"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'content'
  AND (
    COALESCE((storage.foldername(name))[1], '') = ANY (ARRAY['hero-banners','thumbnails','chapter-icons'])
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'teacher'::app_role)
    OR EXISTS (
      SELECT 1 FROM lessons l
      JOIN enrollments e ON e.course_id = l.course_id
      WHERE (public.storage_url_matches_object(l.class_pdf_url, objects.name)
          OR public.storage_url_matches_object(l.video_url, objects.name))
        AND e.user_id = auth.uid() AND e.status = 'active'
    )
    OR EXISTS (
      SELECT 1 FROM materials m
      LEFT JOIN lessons ml ON ml.id = m.lesson_id
      JOIN enrollments e ON e.course_id = COALESCE(m.course_id, ml.course_id)
      WHERE public.storage_url_matches_object(m.file_url, objects.name)
        AND e.user_id = auth.uid() AND e.status = 'active'
    )
    OR EXISTS (
      SELECT 1 FROM notes n
      JOIN lessons nl ON nl.id = n.lesson_id
      JOIN enrollments e ON e.course_id = nl.course_id
      WHERE public.storage_url_matches_object(n.pdf_url, objects.name)
        AND e.user_id = auth.uid() AND e.status = 'active'
    )
    OR EXISTS (
      SELECT 1 FROM questions q
      JOIN quizzes qz ON qz.id = q.quiz_id
      LEFT JOIN lessons ql ON ql.id = qz.lesson_id
      JOIN enrollments e ON e.course_id = COALESCE(qz.course_id, ql.course_id)
      WHERE public.storage_url_matches_object(q.image_url, objects.name)
        AND e.user_id = auth.uid() AND e.status = 'active'
    )
  )
);

-- 4. Comment images: exclude hidden comments
DROP POLICY IF EXISTS "Read comment-images if owner or attached to a comment" ON storage.objects;
CREATE POLICY "Read comment-images if owner or attached to a comment"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'comment-images'
  AND (
    (auth.uid())::text = (storage.foldername(name))[1]
    OR EXISTS (
      SELECT 1 FROM comments c
      WHERE c.image_url = 'comment-images/' || objects.name
        AND COALESCE(c.is_hidden, false) = false
    )
  )
);

-- 5. Questions: explicitly deny anon
REVOKE ALL ON TABLE public.questions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.questions TO authenticated;
GRANT ALL ON public.questions TO service_role;