GRANT INSERT ON public.enrollments TO authenticated;
CREATE POLICY "Admins can create enrollments" ON public.enrollments
FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));