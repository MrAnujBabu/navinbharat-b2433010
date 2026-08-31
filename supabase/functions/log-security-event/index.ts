import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

/**
 * Server-side writer for `public.security_events`.
 *
 * Clients are no longer allowed to INSERT into the table directly (the RLS
 * INSERT policy and the `authenticated` INSERT grant were removed), because a
 * signed-in user could otherwise forge arbitrary `event_type` / `payload`
 * rows in a security-sensitive audit surface.
 *
 * This function:
 *  - verifies the caller's JWT and derives `user_id` from the token (never
 *    from the request body),
 *  - only accepts event types from a fixed allowlist,
 *  - clamps the payload to a small, flat, size-bounded object,
 *  - writes with the service role.
 */

const ALLOWED_EVENT_TYPES = new Set([
  'content_url_resolve_failed',
  'screen_capture_detected',
  'screenshot_blocked',
  'session_conflict',
  'offline_content_access',
  'pdf_load_failed',
  'suspicious_navigation',
])

const MAX_PAYLOAD_BYTES = 2048
const MAX_KEYS = 12
const MAX_STRING_LEN = 512

/** Flat, primitive-only, size-capped copy of the caller-supplied payload. */
function sanitizePayload(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const out: Record<string, unknown> = {}
  let keys = 0
  for (const [rawKey, value] of Object.entries(input as Record<string, unknown>)) {
    if (keys >= MAX_KEYS) break
    const key = rawKey.slice(0, 64)
    if (typeof value === 'string') out[key] = value.slice(0, MAX_STRING_LEN)
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
    else if (typeof value === 'boolean' || value === null) out[key] = value
    else continue
    keys++
  }
  if (JSON.stringify(out).length > MAX_PAYLOAD_BYTES) {
    return { truncated: true }
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const token = authHeader.replace('Bearer ', '')
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token)
    if (claimsError || !claimsData?.claims?.sub) return json({ error: 'Invalid session' }, 401)

    const userId = claimsData.claims.sub as string

    let body: { event_type?: unknown; payload?: unknown }
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid JSON body' }, 400)
    }

    const eventType = typeof body.event_type === 'string' ? body.event_type : ''
    if (!ALLOWED_EVENT_TYPES.has(eventType)) {
      return json({ error: 'Unsupported event_type' }, 400)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Cheap abuse guard so a client loop can't flood the table.
    const { data: allowed } = await admin.rpc('check_rate_limit', {
      _bucket: 'security_events_insert',
      _user_id: userId,
      _max: 60,
      _window_seconds: 300,
    })
    if (allowed === false) return json({ error: 'Rate limited' }, 429)

    const { error } = await admin.from('security_events').insert({
      user_id: userId,
      event_type: eventType,
      payload: sanitizePayload(body.payload),
    })
    if (error) return json({ error: 'Failed to record event' }, 500)

    return json({ ok: true })
  } catch {
    return json({ error: 'Unexpected error' }, 500)
  }
})
