-- 1. doubt_replies: scope teacher access to the assigned teacher only
DROP POLICY IF EXISTS "Users can read replies for their sessions" ON public.doubt_replies;
CREATE POLICY "Users can read replies for their sessions"
ON public.doubt_replies
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.doubt_sessions ds
    WHERE ds.id = doubt_replies.doubt_session_id
      AND (ds.student_id = auth.uid() OR ds.teacher_id = auth.uid())
  )
  OR public.has_role(auth.uid(), 'admin'::app_role)
);

DROP POLICY IF EXISTS "Users insert replies into their sessions" ON public.doubt_replies;
CREATE POLICY "Users insert replies into their sessions"
ON public.doubt_replies
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.doubt_sessions ds
      WHERE ds.id = doubt_replies.doubt_session_id
        AND (ds.student_id = auth.uid() OR ds.teacher_id = auth.uid())
    )
  )
);

-- 2. get_user_role: callers may only resolve their own role (admins: anyone)
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS app_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT role FROM public.user_roles
  WHERE user_id = _user_id
    AND (
      auth.uid() IS NULL                       -- service_role / internal callers
      OR _user_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin'::app_role)
    )
  LIMIT 1
$function$;

-- 3. storage_url_matches_object: exact storage path match, no suffix matching
CREATE OR REPLACE FUNCTION public.storage_url_matches_object(_url text, _object_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _url IS NULL OR _object_name IS NULL OR length(btrim(_object_name)) = 0 THEN false
    ELSE (
      -- internal scheme
      split_part(_url, '?', 1) = 'storage://content/' || _object_name
      -- bare object path
      OR split_part(_url, '?', 1) = _object_name
      OR split_part(_url, '?', 1) = 'content/' || _object_name
      -- Supabase Storage REST paths, anchored at /storage/v1/object/<mode>/content/<name>
      OR regexp_replace(
           split_part(_url, '?', 1),
           '^.*/storage/v1/object/(public|sign|authenticated)/',
           ''
         ) = 'content/' || _object_name
         AND split_part(_url, '?', 1) ~ '/storage/v1/object/(public|sign|authenticated)/content/'
    )
  END
$function$;