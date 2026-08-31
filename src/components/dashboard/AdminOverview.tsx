import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../integrations/supabase/client";
import { logger } from "@/lib/logger";
import { Skeleton } from "../ui/skeleton";
import { ChevronRight, GraduationCap, Users, BookOpen, ShieldCheck, MessageCircleQuestion } from "lucide-react";

interface PlatformStats {
  total_students?: number;
  total_courses?: number;
  total_teachers?: number;
}

const MANAGE_LINKS = [
  { Icon: MessageCircleQuestion, label: "Doubts queue", hint: "Answer student doubts", path: "/doubts" },
  { Icon: ShieldCheck, label: "Security", hint: "Screen protection & alerts", path: "/admin/security" },
];

/**
 * Compact KPI + management strip for admins/teachers. Without it the
 * admin dashboard rendered a 4-tile grid and then ~60% dead vertical space.
 * Numbers come from the existing `get_platform_stats()` RPC — no new backend.
 */
const AdminOverview = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      try {
        // anon/authenticated EXECUTE is revoked on the get_platform_stats RPC
        // (linter 0028), so go through the platform-stats edge function which
        // uses service_role internally and returns aggregate counts only.
        const { data, error } = await supabase.functions.invoke("platform-stats", { method: "GET" });
        if (!mounted.current) return;
        if (error) throw error;
        setStats((data ?? {}) as PlatformStats);
      } catch (err) {
        logger.warn("AdminOverview: platform stats unavailable", { error: String(err) });
        if (mounted.current) setStats(null);
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, []);

  const kpis = [
    { Icon: Users, label: "Students", value: stats?.total_students },
    { Icon: BookOpen, label: "Courses", value: stats?.total_courses },
    { Icon: GraduationCap, label: "Teachers", value: stats?.total_teachers },
  ];

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : stats ? (
        <div className="grid grid-cols-3 gap-3">
          {kpis.map(({ Icon, label, value }) => (
            <div key={label} className="rounded-xl border border-border bg-card p-3">
              <Icon className="mb-2 h-4 w-4 text-primary" />
              <p className="text-xl font-bold tabular-nums text-foreground leading-none">
                {typeof value === "number" ? value.toLocaleString() : "—"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border bg-card divide-y divide-border">
        {MANAGE_LINKS.map(({ Icon, label, hint, path }) => (
          <button
            key={path}
            type="button"
            onClick={() => navigate(path)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-muted [@media(hover:hover)]:hover:bg-muted"
          >
            <span className="rounded-lg bg-primary/10 p-2 text-primary">
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-foreground">{label}</span>
              <span className="block truncate text-xs text-muted-foreground">{hint}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
};

export default AdminOverview;