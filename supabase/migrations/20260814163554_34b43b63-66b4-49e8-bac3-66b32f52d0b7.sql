-- Storage policies on several buckets call public.has_role(...) while being
-- defined for the PUBLIC role. Signed-out (anon) callers therefore hit
-- "permission denied for function has_role" and the ENTIRE policy evaluation
-- aborts with 403 — which broke signing/reading of course thumbnails,
-- hero banners and chapter icons for every visitor.
-- has_role is a read-only boolean lookup (returns false for a null/unknown
-- user) and grants no access on its own, so anon may execute it.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon;