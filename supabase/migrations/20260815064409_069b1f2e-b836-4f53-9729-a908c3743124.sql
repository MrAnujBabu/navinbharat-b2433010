UPDATE public.landing_content
SET content = jsonb_build_object(
  'title', 'NEET ki taiyari, Hindi mein.',
  'subtitle', 'Physics, Chemistry aur Biology — NCERT line-by-line, DPP, PYQ aur test series. Naveen Bharat ke saath sab Hindi mein samjhaya, phone par.',
  'cta_text', 'Free lesson dekhein'
)
WHERE section_key = 'hero';