DROP POLICY IF EXISTS "Users can enroll in free courses only" ON public.enrollments;
DROP POLICY IF EXISTS "Users can self-enroll free courses or verified paid courses" ON public.enrollments;
REVOKE INSERT ON public.enrollments FROM authenticated;
GRANT ALL ON public.enrollments TO service_role;