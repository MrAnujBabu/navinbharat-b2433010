-- Naveen Bharat — admin-managed external PDF link allowlist
-- Run these in the Supabase SQL editor (two separate runs — a new enum value
-- cannot be used in the same transaction that adds it).

-- ---- Run 1 -------------------------------------------------------------
ALTER TYPE public.trusted_host_category ADD VALUE IF NOT EXISTS 'pdf';

-- ---- Run 2 -------------------------------------------------------------
-- pdf-proxy reads this table with the service-role key (RLS bypassed).
GRANT ALL ON public.trusted_hosts TO service_role;

INSERT INTO public.trusted_hosts (host, category, label, enabled)
VALUES
  ('cwmediabkt99.crwilladmin.com', 'pdf', 'CW batch notes CDN', true),
  ('ncert.nic.in',                 'pdf', 'NCERT textbooks',    true)
ON CONFLICT (host, category) DO UPDATE SET enabled = true;

-- Verify
SELECT host, category, enabled FROM public.trusted_hosts WHERE category IN ('pdf','frame') ORDER BY host;

-- NOTE: until Run 1 is applied, the admin UI stores PDF links under the
-- existing 'frame' category and pdf-proxy accepts both ('pdf','frame').
