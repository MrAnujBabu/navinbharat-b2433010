-- Layer-2 hardening: `anon` still held SELECT grants on admin/PII tables even
-- though none of them has an anon/public RLS policy. Nothing leaks today, but
-- one accidental permissive policy would expose them. Defense in depth: drop
-- the grant. Edge functions use service_role and are unaffected.
REVOKE SELECT ON
  public.audit_log,
  public.leads,
  public.deletion_requests,
  public.error_logs,
  public.funnel_entries,
  public.funnel_stages,
  public.crawl_history,
  public.automation_rules,
  public.marketing_campaigns,
  public.meta_ad_config,
  public.security_alerts,
  public.security_events,
  public.dependency_scan_reports,
  public.pdf_proxy_metrics,
  public.payment_events,
  public.payment_requests,
  public.razorpay_payments,
  public.user_subscriptions,
  public.chatbot_logs,
  public.chatbot_feedback,
  public.chatbot_settings,
  public.students,
  public.user_roles,
  public.user_sessions,
  public.user_preferences,
  public.push_tokens,
  public.content_reports
FROM anon;