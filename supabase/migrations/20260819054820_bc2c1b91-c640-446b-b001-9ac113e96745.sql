DROP POLICY IF EXISTS "Users insert own attempts" ON public.quiz_attempts;
DROP POLICY IF EXISTS "Users update own attempts" ON public.quiz_attempts;

DROP POLICY IF EXISTS "Users can update own progress" ON public.user_progress;
CREATE POLICY "Users can update own progress" ON public.user_progress
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own progress read" ON public.user_progress;

REVOKE SELECT ON public.enrollments FROM anon;
REVOKE SELECT ON public.user_progress FROM anon;
REVOKE SELECT ON public.quiz_attempts FROM anon;
REVOKE SELECT ON public.lesson_progress FROM anon;