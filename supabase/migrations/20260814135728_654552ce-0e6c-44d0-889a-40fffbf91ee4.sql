DROP POLICY IF EXISTS "landing_courses public read active" ON public.landing_courses;
DROP POLICY IF EXISTS "testimonials public read active" ON public.landing_testimonials;

CREATE POLICY "landing_courses anon read active" ON public.landing_courses
  FOR SELECT TO anon USING (is_active = true);
CREATE POLICY "landing_courses auth read" ON public.landing_courses
  FOR SELECT TO authenticated USING (is_active = true OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "testimonials anon read active" ON public.landing_testimonials
  FOR SELECT TO anon USING (is_active = true);
CREATE POLICY "testimonials auth read" ON public.landing_testimonials
  FOR SELECT TO authenticated USING (is_active = true OR public.has_role(auth.uid(), 'admin'));