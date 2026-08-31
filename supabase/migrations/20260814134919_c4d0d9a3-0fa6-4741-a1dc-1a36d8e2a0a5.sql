-- 1. landing_courses
CREATE TABLE public.landing_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  badge text NOT NULL DEFAULT '',
  title text NOT NULL,
  faculty text NOT NULL DEFAULT '',
  language text NOT NULL DEFAULT 'Hindi',
  duration text NOT NULL DEFAULT '',
  start_date text NOT NULL DEFAULT '',
  seats text,
  price_mrp numeric,
  price_effective numeric,
  short text NOT NULL DEFAULT '',
  image_url text,
  route text,
  course_id bigint REFERENCES public.courses(id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.landing_courses TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.landing_courses TO authenticated;
GRANT ALL ON public.landing_courses TO service_role;
ALTER TABLE public.landing_courses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "landing_courses public read active" ON public.landing_courses FOR SELECT TO anon, authenticated USING (is_active = true OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "landing_courses admin manage" ON public.landing_courses FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_landing_courses_updated BEFORE UPDATE ON public.landing_courses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. landing_testimonials
CREATE TABLE public.landing_testimonials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_name text NOT NULL,
  exam_track text,
  quote text NOT NULL,
  avatar_url text,
  rating integer NOT NULL DEFAULT 5,
  position integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.landing_testimonials TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.landing_testimonials TO authenticated;
GRANT ALL ON public.landing_testimonials TO service_role;
ALTER TABLE public.landing_testimonials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "testimonials public read active" ON public.landing_testimonials FOR SELECT TO anon, authenticated USING (is_active = true OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "testimonials admin manage" ON public.landing_testimonials FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_landing_testimonials_updated BEFORE UPDATE ON public.landing_testimonials FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. live_reminders
CREATE TABLE public.live_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES public.live_sessions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, session_id)
);
GRANT SELECT, INSERT, DELETE ON public.live_reminders TO authenticated;
GRANT ALL ON public.live_reminders TO service_role;
ALTER TABLE public.live_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "live_reminders own select" ON public.live_reminders FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "live_reminders own insert" ON public.live_reminders FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "live_reminders own delete" ON public.live_reminders FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 4. content_reports
CREATE TABLE public.content_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL DEFAULT auth.uid(),
  content_type text NOT NULL,
  content_id uuid NOT NULL,
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open',
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.content_reports TO authenticated;
GRANT ALL ON public.content_reports TO service_role;
ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reports own or admin select" ON public.content_reports FOR SELECT TO authenticated USING (auth.uid() = reporter_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "reports insert own" ON public.content_reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY "reports admin update" ON public.content_reports FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5. moderation / fraud columns
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS hidden_reason text;
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS hidden_reason text;
ALTER TABLE public.community_comments ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS hidden_reason text;
ALTER TABLE public.doubt_replies ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS hidden_reason text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_blocked boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS blocked_reason text;
ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS fraud_reviewed_at timestamptz, ADD COLUMN IF NOT EXISTS fraud_note text;

-- 6. admin RPCs
CREATE OR REPLACE FUNCTION public.admin_hide_content(_content_type text, _content_id uuid, _hidden boolean, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF _content_type = 'post' THEN
    UPDATE public.community_posts SET is_hidden = _hidden, hidden_reason = CASE WHEN _hidden THEN _reason ELSE NULL END WHERE id = _content_id;
  ELSIF _content_type = 'comment' THEN
    UPDATE public.community_comments SET is_hidden = _hidden, hidden_reason = CASE WHEN _hidden THEN _reason ELSE NULL END WHERE id = _content_id;
  ELSIF _content_type = 'reply' THEN
    UPDATE public.doubt_replies SET is_hidden = _hidden, hidden_reason = CASE WHEN _hidden THEN _reason ELSE NULL END WHERE id = _content_id;
  ELSIF _content_type = 'lesson_comment' THEN
    UPDATE public.comments SET is_hidden = _hidden, hidden_reason = CASE WHEN _hidden THEN _reason ELSE NULL END WHERE id = _content_id;
  ELSE
    RAISE EXCEPTION 'Unknown content type %', _content_type;
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.admin_hide_content(text, uuid, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_hide_content(text, uuid, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_resolve_report(_report_id uuid, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF _status NOT IN ('open','resolved','dismissed') THEN RAISE EXCEPTION 'Bad status'; END IF;
  UPDATE public.content_reports SET status = _status, resolved_by = auth.uid(), resolved_at = now() WHERE id = _report_id;
END; $$;
REVOKE ALL ON FUNCTION public.admin_resolve_report(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_report(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_user_block(_user_id uuid, _blocked boolean, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE public.profiles SET is_blocked = _blocked, blocked_reason = CASE WHEN _blocked THEN _reason ELSE NULL END WHERE id = _user_id;
  INSERT INTO public.audit_log (user_id, action, table_name, record_count, metadata)
  VALUES (auth.uid(), CASE WHEN _blocked THEN 'block_user' ELSE 'unblock_user' END, 'profiles', 1, jsonb_build_object('target', _user_id, 'reason', _reason));
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_user_block(uuid, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_block(uuid, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_revoke_enrollment(_enrollment_id bigint, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  DELETE FROM public.enrollments WHERE id = _enrollment_id;
  INSERT INTO public.audit_log (user_id, action, table_name, record_count, metadata)
  VALUES (auth.uid(), 'revoke_enrollment', 'enrollments', 1, jsonb_build_object('enrollment_id', _enrollment_id, 'reason', _reason));
END; $$;
REVOKE ALL ON FUNCTION public.admin_revoke_enrollment(bigint, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_enrollment(bigint, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_mark_enrollment_legit(_enrollment_id bigint, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE public.enrollments SET fraud_reviewed_at = now(), fraud_note = _note WHERE id = _enrollment_id;
END; $$;
REVOKE ALL ON FUNCTION public.admin_mark_enrollment_legit(bigint, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_enrollment_legit(bigint, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_batch_roster(_course_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _out jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT COALESCE(jsonb_agg(s.x ORDER BY s.x->>'purchased_at' DESC), '[]'::jsonb) INTO _out
  FROM (
    SELECT jsonb_build_object(
      'enrollment_id', e.id, 'user_id', e.user_id, 'full_name', p.full_name,
      'email', p.email, 'mobile', p.mobile, 'purchased_at', e.purchased_at,
      'status', e.status, 'progress_percentage', e.progress_percentage,
      'is_blocked', p.is_blocked
    ) AS x
    FROM public.enrollments e
    LEFT JOIN public.profiles p ON p.id = e.user_id
    WHERE e.course_id = _course_id
  ) s;
  RETURN _out;
END; $$;
REVOKE ALL ON FUNCTION public.admin_get_batch_roster(bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_batch_roster(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_suspicious_enrollments(_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _out jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  WITH base AS (
    SELECT e.id, e.user_id, e.course_id, e.purchased_at,
           c.title AS course_title, COALESCE(c.price, 0) AS course_price,
           p.full_name, p.email, p.mobile, p.is_blocked,
           (SELECT count(*) FROM public.razorpay_payments r
             WHERE r.user_id = e.user_id AND r.course_id = e.course_id AND r.status IN ('paid','captured','completed','success')) AS ok_count,
           (SELECT max(r.amount) FROM public.razorpay_payments r
             WHERE r.user_id = e.user_id AND r.course_id = e.course_id AND r.status IN ('paid','captured','completed','success')) AS max_ok_amount,
           (SELECT count(*) FROM public.razorpay_payments r
             WHERE r.user_id = e.user_id AND r.course_id = e.course_id) AS any_paid_count,
           (SELECT r.status FROM public.razorpay_payments r
             WHERE r.user_id = e.user_id AND r.course_id = e.course_id
             ORDER BY r.created_at DESC LIMIT 1) AS latest_status
    FROM public.enrollments e
    JOIN public.courses c ON c.id = e.course_id
    LEFT JOIN public.profiles p ON p.id = e.user_id
    WHERE e.fraud_reviewed_at IS NULL
  ), scored AS (
    SELECT b.*,
      CASE
        WHEN b.course_price > 0 AND b.any_paid_count = 0 THEN 'no_payment'
        WHEN b.course_price > 0 AND b.ok_count = 0 AND b.latest_status IS NOT NULL THEN 'payment_failed'
        WHEN b.course_price > 0 AND b.max_ok_amount IS NOT NULL AND b.max_ok_amount < b.course_price THEN 'amount_mismatch'
        ELSE NULL
      END AS rule
    FROM base b
  ), picked AS (
    SELECT * FROM scored WHERE rule IS NOT NULL ORDER BY purchased_at DESC NULLS LAST LIMIT COALESCE(_limit, 200)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'user_id', s.user_id, 'course_id', s.course_id, 'course_title', s.course_title,
    'course_price', s.course_price, 'full_name', s.full_name, 'email', s.email, 'mobile', s.mobile,
    'is_blocked', s.is_blocked, 'purchased_at', s.purchased_at, 'ok_count', s.ok_count,
    'max_ok_amount', s.max_ok_amount, 'any_paid_count', s.any_paid_count, 'latest_status', s.latest_status,
    'rule', s.rule,
    'severity', CASE s.rule WHEN 'no_payment' THEN 'critical' WHEN 'payment_failed' THEN 'high'
                            WHEN 'amount_mismatch' THEN 'medium' ELSE 'low' END
  ) ORDER BY s.purchased_at DESC NULLS LAST), '[]'::jsonb) INTO _out FROM picked s;
  RETURN _out;
END; $$;
REVOKE ALL ON FUNCTION public.admin_get_suspicious_enrollments(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_suspicious_enrollments(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_user_snapshot(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _out jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT jsonb_build_object(
    'profile', (SELECT to_jsonb(p) FROM public.profiles p WHERE p.id = _user_id),
    'enrollments', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', e.id, 'course_id', e.course_id, 'course_title', c.title,
        'purchased_at', e.purchased_at, 'status', e.status,
        'progress_percentage', e.progress_percentage) ORDER BY e.purchased_at DESC NULLS LAST), '[]'::jsonb)
      FROM public.enrollments e LEFT JOIN public.courses c ON c.id = e.course_id WHERE e.user_id = _user_id),
    'batch_count', (SELECT count(DISTINCT course_id) FROM public.enrollments WHERE user_id = _user_id),
    'payments', (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC), '[]'::jsonb)
      FROM public.razorpay_payments r WHERE r.user_id = _user_id),
    'total_spent', (SELECT COALESCE(sum(r.amount), 0) FROM public.razorpay_payments r
      WHERE r.user_id = _user_id AND r.status IN ('paid','captured','completed','success')),
    'lessons_completed', (SELECT count(*) FROM public.lesson_progress lp WHERE lp.user_id = _user_id AND lp.completed),
    'quiz_attempts', (SELECT count(*) FROM public.quiz_attempts qa WHERE qa.user_id = _user_id),
    'last_session', (SELECT to_jsonb(us) FROM public.user_sessions us WHERE us.user_id = _user_id ORDER BY us.last_active_at DESC LIMIT 1)
  ) INTO _out;
  RETURN _out;
END; $$;
REVOKE ALL ON FUNCTION public.admin_get_user_snapshot(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_user_snapshot(uuid) TO authenticated;

-- 7. quiz review for own submitted attempt
CREATE OR REPLACE FUNCTION public.get_quiz_review(_attempt_id uuid)
RETURNS TABLE(id uuid, quiz_id uuid, question_text text, question_type text, options jsonb,
              correct_answer text, explanation text, marks integer, negative_marks integer,
              order_index integer, image_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _quiz uuid;
BEGIN
  SELECT qa.quiz_id INTO _quiz FROM public.quiz_attempts qa
  WHERE qa.id = _attempt_id AND qa.submitted_at IS NOT NULL
    AND (qa.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
  IF _quiz IS NULL THEN RAISE EXCEPTION 'Attempt not found or not submitted'; END IF;
  RETURN QUERY
  SELECT q.id, q.quiz_id, q.question_text, q.question_type, q.options, q.correct_answer,
         q.explanation, q.marks, q.negative_marks, q.order_index, q.image_url
  FROM public.questions q WHERE q.quiz_id = _quiz ORDER BY q.order_index;
END; $$;
REVOKE ALL ON FUNCTION public.get_quiz_review(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_review(uuid) TO authenticated;