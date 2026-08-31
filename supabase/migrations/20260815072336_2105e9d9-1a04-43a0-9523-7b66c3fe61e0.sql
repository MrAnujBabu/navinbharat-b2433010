UPDATE public.landing_content
SET content = jsonb_set(
      jsonb_set(content::jsonb, '{title}', '"NEET ka pura syllabus. Ek disciplined system."'::jsonb, true),
      '{subtitle}', '"NCERT line-by-line lessons, daily DPP, 10 saal ke PYQ aur weekly full-length tests — ek structured batch mein."'::jsonb, true)
WHERE section_key = 'hero';