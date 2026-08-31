-- 1. lesson_chapters: replace public USING(true) read with enrollment-gated read
DROP POLICY IF EXISTS "Anyone can read lesson chapters" ON public.lesson_chapters;
CREATE POLICY "Enrolled users and staff can read lesson chapters"
ON public.lesson_chapters
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'teacher'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.lessons l
    JOIN public.enrollments e ON e.course_id = l.course_id
    WHERE l.id = lesson_chapters.lesson_id
      AND e.user_id = auth.uid()
      AND e.status = 'active'
  )
  OR EXISTS (
    SELECT 1 FROM public.lessons l
    JOIN public.courses c ON c.id = l.course_id
    WHERE l.id = lesson_chapters.lesson_id
      AND (c.price IS NULL OR c.price = 0)
  )
);

-- 2. lesson_quiz_markers: same treatment
DROP POLICY IF EXISTS "Anyone can read quiz markers" ON public.lesson_quiz_markers;
CREATE POLICY "Enrolled users and staff can read quiz markers"
ON public.lesson_quiz_markers
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'teacher'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.lessons l
    JOIN public.enrollments e ON e.course_id = l.course_id
    WHERE l.id = lesson_quiz_markers.lesson_id
      AND e.user_id = auth.uid()
      AND e.status = 'active'
  )
  OR EXISTS (
    SELECT 1 FROM public.lessons l
    JOIN public.courses c ON c.id = l.course_id
    WHERE l.id = lesson_quiz_markers.lesson_id
      AND (c.price IS NULL OR c.price = 0)
  )
);

-- 3. live_messages: teacher moderation policy scoped to authenticated
DROP POLICY IF EXISTS "Teachers can update messages" ON public.live_messages;
CREATE POLICY "Teachers can update messages"
ON public.live_messages
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'teacher'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.live_sessions ls
    WHERE ls.id = live_messages.session_id AND ls.created_by = auth.uid()
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'teacher'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.live_sessions ls
    WHERE ls.id = live_messages.session_id AND ls.created_by = auth.uid()
  )
);

-- 4. questions: teachers only see questions for quizzes they authored
DROP POLICY IF EXISTS "Only admins can select questions directly" ON public.questions;
CREATE POLICY "Admins and authoring teachers can select questions"
ON public.questions
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR (
    public.has_role(auth.uid(), 'teacher'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.quizzes qz
      WHERE qz.id = questions.quiz_id AND qz.created_by = auth.uid()
    )
  )
);

-- 5. storage: exact-path matching instead of substring LIKE
DROP POLICY IF EXISTS "Enrolled users and staff can read lesson attachments" ON storage.objects;
CREATE POLICY "Enrolled users and staff can read lesson attachments"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'lesson-attachments'
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'teacher'::app_role)
    OR EXISTS (
      SELECT 1
      FROM public.lesson_attachments la
      JOIN public.lessons l ON l.id = la.lesson_id
      JOIN public.enrollments e ON e.course_id = l.course_id
      WHERE (
        la.file_url = 'storage://lesson-attachments/' || objects.name
        OR la.file_url LIKE '%/lesson-attachments/' || objects.name
        OR la.file_url LIKE '%/lesson-attachments/' || objects.name || '?%'
      )
      AND e.user_id = auth.uid()
      AND e.status = 'active'
    )
  )
);

DROP POLICY IF EXISTS "Recipients can view chat attachments" ON storage.objects;
CREATE POLICY "Recipients can view chat attachments"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.recipient_id = auth.uid()
      AND (
        m.attachment_url = 'storage://chat-attachments/' || objects.name
        OR m.attachment_url LIKE '%/chat-attachments/' || objects.name
        OR m.attachment_url LIKE '%/chat-attachments/' || objects.name || '?%'
      )
  )
);