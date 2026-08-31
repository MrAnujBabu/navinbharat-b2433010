
-- 1) content bucket: scope admin policies to authenticated
DROP POLICY IF EXISTS "Admins can delete content files" ON storage.objects;
CREATE POLICY "Admins can delete content files" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'content' AND has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can update content files" ON storage.objects;
CREATE POLICY "Admins can update content files" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'content' AND has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (bucket_id = 'content' AND has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can upload content files" ON storage.objects;
CREATE POLICY "Admins can upload content files" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'content' AND has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can manage content" ON storage.objects;
CREATE POLICY "Admins can manage content" ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'content' AND has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (bucket_id = 'content' AND has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can list content" ON storage.objects;
CREATE POLICY "Admins can list content" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'content' AND has_role(auth.uid(), 'admin'::app_role));

-- 2) study-materials: strict, path-anchored match instead of raw concatenation
CREATE OR REPLACE FUNCTION public.storage_url_matches_bucket_object(_url text, _bucket text, _object_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _url IS NULL OR _object_name IS NULL OR _bucket IS NULL
      OR length(btrim(_object_name)) = 0 OR length(btrim(_bucket)) = 0 THEN false
    ELSE (
      split_part(_url, '?', 1) = 'storage://' || _bucket || '/' || _object_name
      OR split_part(_url, '?', 1) = _object_name
      OR split_part(_url, '?', 1) = _bucket || '/' || _object_name
      OR (
        split_part(_url, '?', 1) ~ ('/storage/v1/object/(public|sign|authenticated)/' || _bucket || '/')
        AND regexp_replace(
              split_part(_url, '?', 1),
              '^.*/storage/v1/object/(public|sign|authenticated)/',
              ''
            ) = _bucket || '/' || _object_name
      )
    )
  END
$$;

REVOKE ALL ON FUNCTION public.storage_url_matches_bucket_object(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_url_matches_bucket_object(text, text, text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Enrolled students or staff can read study material files" ON storage.objects;
CREATE POLICY "Enrolled students or staff can read study material files" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'study-materials'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'teacher'::app_role)
    OR EXISTS (
      SELECT 1
      FROM study_materials sm
      JOIN enrollments e ON e.course_id = sm.course_id AND e.user_id = auth.uid()
      WHERE e.status = 'active'
        AND public.storage_url_matches_bucket_object(sm.file_url, 'study-materials', objects.name)
    )
  )
);

-- 3) community_reactions: explicit, documented deny for updates
DROP POLICY IF EXISTS "Reactions cannot be edited" ON public.community_reactions;
CREATE POLICY "Reactions cannot be edited" ON public.community_reactions FOR UPDATE TO authenticated
USING (false) WITH CHECK (false);

-- 4) unused SECURITY DEFINER helper: not callable from the API
REVOKE ALL ON FUNCTION public.user_can_access_live_session_topic(text) FROM PUBLIC, anon, authenticated;
