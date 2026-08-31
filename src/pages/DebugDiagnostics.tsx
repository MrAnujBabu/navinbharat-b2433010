import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, Trash2 } from "lucide-react";
import {
  clearDiagnostics,
  formatDiagnostics,
  readDiagnostics,
  type DiagnosticEntry,
} from "@/lib/freezeDiagnostics";

export default function DebugDiagnostics() {
  const [entries, setEntries] = useState<DiagnosticEntry[]>(() => readDiagnostics());
  const text = useMemo(() => formatDiagnostics(entries), [entries]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text || "No diagnostics recorded");
      toast.success("Copy ho gaya");
    } catch {
      toast.error("Copy nahi hua — text select karke manually copy karo.");
    }
  };

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <h1 className="text-lg font-semibold">Reader diagnostics</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Freeze aur fullscreen failure ke last {entries.length} record. Yahin se copy karke bhej do.
      </p>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-foreground px-3 text-sm font-medium text-background transition-opacity duration-150 active:opacity-80"
        >
          <Copy className="h-4 w-4" aria-hidden="true" />
          Copy logs
        </button>
        <button
          type="button"
          onClick={() => {
            clearDiagnostics();
            setEntries([]);
            toast.success("Logs clear");
          }}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-3 text-sm text-foreground/70 transition-colors duration-150 active:bg-muted"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Clear
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="mt-6 rounded-xl border border-border p-6 text-center">
          <p className="text-sm font-medium">Abhi koi log nahi hai.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            App freeze ya fullscreen fail hone par entry apne aap yahan aa jaayegi.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {entries.map((e) => (
            <li key={`${e.at}-${e.kind}`} className="rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{e.message}</span>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] uppercase text-foreground/70">
                  {e.kind}
                </span>
              </div>
              <p className="mt-1 break-words text-xs text-muted-foreground">
                {new Date(e.at).toLocaleString()} · {e.route} · {e.viewport} · action: {e.lastAction}
              </p>
              {e.stack && (
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-2 text-[11px] leading-snug">
                  {e.stack}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
