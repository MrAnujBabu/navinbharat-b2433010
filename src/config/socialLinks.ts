/**
 * Single source of truth for hardcoded outbound social URLs.
 *
 * Admin-editable copies live in `site_settings` (telegram_url, youtube_url, ...)
 * and are rendered by `SocialLinks`. These constants back the static landing
 * chrome (Footer, CommunityStrip) so a handle change is a one-line edit.
 *
 * Guard: scripts/check-social-links.mjs fails CI on any `t.me/` literal
 * outside this file.
 */
export const TELEGRAM_URL = "https://t.me/Naveenbharat1";
export const YOUTUBE_URL = "https://youtube.com/@naveenbharat";
