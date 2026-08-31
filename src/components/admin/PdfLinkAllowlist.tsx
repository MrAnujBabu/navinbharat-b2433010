import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, FileText, PlayCircle } from "lucide-react";
import { remotePdfProxyUrl } from "@/lib/pdfViewerUrl";
import type { TrustedHost } from "@/hooks/useTrustedHosts";

const LINKS_KEY = "nb_admin_pdf_links";

export interface PdfProbeResult {
  url: string;
  ok: boolean;
  status: number;
  contentType: string | null;
  acceptRanges: string | null;
  bytes: number | null;
  ms: number;
  message: string;
}

/** Extract every https URL from a pasted blob (one per line or inline). */
export function parsePdfLinks(raw: string): string[] {
  const found = raw.match(/https:\/\/[^\s"'<>]+/gi) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of found) {
    const clean = u.replace(/[.,;)]+$/, "");
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

export function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

const loadLinks = (): string[] => {
  try {
    const raw = localStorage.getItem(LINKS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
};

const saveLinks = (links: string[]) => {
  try {
    localStorage.setItem(LINKS_KEY, JSON.stringify(links.slice(0, 200)));
  } catch {
    /* quota — non-fatal */
  }
};

/** Probe one link through pdf-proxy with a small Range request. */
export async function probePdfLink(url: string): Promise<PdfProbeResult> {
  const started = performance.now();
  const base: Omit<PdfProbeResult, "ok" | "status" | "message"> = {
    url,
    contentType: null,
    acceptRanges: null,
    bytes: null,
    ms: 0,
  };
  try {
    const res = await fetch(remotePdfProxyUrl(url), {
      headers: { Range: "bytes=0-2047" },
    });
    const ms = Math.round(performance.now() - started);
    const contentType = res.headers.get("content-type");
    const acceptRanges = res.headers.get("accept-ranges");
    if (!res.ok && res.status !== 206) {
      let detail = "";
      try {
        detail = ((await res.json()) as { error?: string }).error ?? "";
      } catch {
        /* body may not be JSON */
      }
      return {
        ...base,
        ms,
        contentType,
        acceptRanges,
        ok: false,
        status: res.status,
        message: detail || `HTTP ${res.status}`,
      };
    }
    const buf = await res.arrayBuffer();
    const head = new TextDecoder().decode(new Uint8Array(buf.slice(0, 5)));
    const isPdf = head.startsWith("%PDF");
    return {
      ...base,
      ms: Math.round(performance.now() - started),
      contentType,
      acceptRanges,
      bytes: buf.byteLength,
      ok: isPdf,
      status: res.status,
      message: isPdf
        ? `PDF OK${res.status === 206 ? " · Range supported" : " · full body (no Range)"}`
        : `Not a PDF — first bytes were "${head.replace(/[^\x20-\x7e]/g, ".")}"`,
    };
  } catch (err) {
    return {
      ...base,
      ms: Math.round(performance.now() - started),
      ok: false,
      status: 0,
      message: (err as Error)?.message || "Network error",
    };
  }
}

interface Props {
  hosts: TrustedHost[];
  refetch: () => void;
}

export default function PdfLinkAllowlist({ hosts, refetch }: Props) {
  const [bulk, setBulk] = useState("");
  const [saving, setSaving] = useState(false);
  const [links, setLinks] = useState<string[]>(loadLinks);
  const [results, setResults] = useState<Record<string, PdfProbeResult | "pending">>({});

  const pdfHosts = useMemo(
    () => hosts.filter((h) => h.category === "pdf" || h.category === "frame"),
    [hosts],
  );
  const enabledHostSet = useMemo(
    () => new Set(pdfHosts.filter((h) => h.enabled).map((h) => h.host.toLowerCase())),
    [pdfHosts],
  );

  const isAllowed = useCallback(
    (url: string) => {
      const h = hostOf(url);
      if (!h) return false;
      for (const entry of enabledHostSet) {
        if (h === entry || h.endsWith(`.${entry}`)) return true;
      }
      return false;
    },
    [enabledHostSet],
  );

  const handleAdd = async () => {
    const urls = parsePdfLinks(bulk);
    if (urls.length === 0) {
      toast.error("Paste at least one https:// PDF link");
      return;
    }
    const existing = new Set(pdfHosts.map((h) => h.host.toLowerCase()));
    const newHosts = Array.from(
      new Set(urls.map(hostOf).filter((h): h is string => !!h && !existing.has(h))),
    );

    setSaving(true);
    if (newHosts.length > 0) {
      const rows = newHosts.map((host) => ({
        host,
        category: "pdf",
        label: "External PDF link",
        enabled: true,
      }));
      // `pdf` enum value may not exist yet on older databases — fall back to
      // the `frame` category, which pdf-proxy also accepts.
      let { error } = await supabase.from("trusted_hosts").insert(rows as never);
      if (error) {
        const fallback = rows.map((r) => ({ ...r, category: "frame" }));
        ({ error } = await supabase.from("trusted_hosts").insert(fallback as never));
      }
      if (error) {
        setSaving(false);
        toast.error(error.message);
        return;
      }
    }
    const merged = Array.from(new Set([...urls, ...links]));
    setLinks(merged);
    saveLinks(merged);
    setBulk("");
    setSaving(false);
    refetch();
    toast.success(
      newHosts.length > 0
        ? `${newHosts.length} host allowed · ${urls.length} link saved`
        : `${urls.length} link saved (hosts already allowed)`,
    );
  };

  const removeLink = (url: string) => {
    const next = links.filter((l) => l !== url);
    setLinks(next);
    saveLinks(next);
  };

  const runProbe = async (url: string) => {
    setResults((r) => ({ ...r, [url]: "pending" }));
    const res = await probePdfLink(url);
    setResults((r) => ({ ...r, [url]: res }));
  };

  const runAll = async () => {
    for (const url of links) await runProbe(url);
  };

  const toggleHost = async (h: TrustedHost, val: boolean) => {
    const { error } = await supabase
      .from("trusted_hosts")
      .update({ enabled: val })
      .eq("id", h.id);
    if (error) toast.error(error.message);
    else refetch();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            External PDF links allow करें
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            नीचे पूरे PDF links paste करें (एक line में एक)। Host अपने आप allowlist में जुड़ जाएगा
            और <code>pdf-proxy</code> 60 सेकंड के अंदर उसे accept करने लगेगा — कोई code change नहीं।
          </p>
          <Textarea
            rows={4}
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            placeholder={"https://ncert.nic.in/textbook/pdf/kebo118.pdf\nhttps://ncert.nic.in/textbook/pdf/kebo111.pdf"}
            className="font-mono text-xs"
          />
          <div className="flex items-center gap-2">
            <Button onClick={handleAdd} disabled={saving} size="sm">
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
              Allow &amp; save links
            </Button>
            {links.length > 0 && (
              <Button variant="outline" size="sm" onClick={runAll}>
                <PlayCircle className="h-4 w-4 mr-1" /> Test all
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {pdfHosts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Allowed PDF hosts ({pdfHosts.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {pdfHosts.map((h) => (
              <span
                key={h.id}
                className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-mono"
              >
                {h.host}
                <Switch
                  className="scale-75"
                  checked={h.enabled}
                  onCheckedChange={(v) => toggleHost(h, v)}
                  aria-label={`Toggle ${h.host}`}
                />
              </span>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Saved links ({links.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {links.length === 0 ? (
            <p className="text-sm text-muted-foreground">अभी कोई link नहीं जोड़ा गया।</p>
          ) : (
            links.map((url) => {
              const res = results[url];
              return (
                <div key={url} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="flex-1 min-w-0 font-mono text-xs break-all">{url}</span>
                    <Badge variant={isAllowed(url) ? "secondary" : "outline"} className="shrink-0 text-[10px]">
                      {isAllowed(url) ? "allowed" : "not allowed"}
                    </Badge>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => runProbe(url)}>
                      {res === "pending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeLink(url)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  {res && res !== "pending" && (
                    <div
                      className={`text-xs rounded-md px-2 py-1.5 ${
                        res.ok ? "bg-primary/10 text-foreground" : "bg-destructive/10 text-destructive"
                      }`}
                    >
                      <div className="font-medium">{res.message}</div>
                      <div className="text-foreground/70 mt-0.5 font-mono break-all">
                        status {res.status} · {res.contentType ?? "no content-type"} ·
                        ranges {res.acceptRanges ?? "—"} · {res.bytes ?? 0} B · {res.ms} ms
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
