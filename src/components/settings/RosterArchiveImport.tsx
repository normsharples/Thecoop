import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { Upload, Loader2, AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { parseDeputyRoster, type ParseResult } from "@/lib/deputyRoster";
import { cn } from "@/lib/utils";

const CHUNK = 500;

export default function RosterArchiveImport() {
  const { selectedRestaurantIds } = useSelectedRestaurant();
  const qc = useQueryClient();
  const [preview, setPreview] = useState<ParseResult | null>(null);
  const [storeId, setStoreId] = useState<string>(selectedRestaurantIds[0] ?? "");
  const [busy, setBusy] = useState(false);

  const { data: stores = [] } = useQuery({
    queryKey: ["archive-stores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id, name")
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });

  const { data: summary } = useQuery({
    queryKey: ["roster-archive-summary"],
    queryFn: async () => {
      const { count } = await supabase
        .from("roster_archive")
        .select("*", { count: "exact", head: true });
      const { data: range } = await supabase
        .from("roster_archive")
        .select("work_date")
        .order("work_date", { ascending: true })
        .limit(1);
      const { data: latest } = await supabase
        .from("roster_archive")
        .select("work_date")
        .order("work_date", { ascending: false })
        .limit(1);
      const { count: unlinked } = await supabase
        .from("roster_archive")
        .select("*", { count: "exact", head: true })
        .is("employee_id", null);
      return {
        total: count ?? 0,
        from: range?.[0]?.work_date ?? null,
        to: latest?.[0]?.work_date ?? null,
        unlinked: unlinked ?? 0,
      };
    },
  });

  const onFile = async (file: File) => {
    try {
      const text = await file.text();
      const result = parseDeputyRoster(text);
      if (result.rows.length === 0 && result.skipped.length === 0) {
        toast.error("No rows found in that file");
        return;
      }
      setPreview(result);
    } catch {
      toast.error("Couldn't read that file");
    }
  };

  const doImport = async () => {
    if (!preview || !storeId) {
      toast.error("Pick a store first");
      return;
    }
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const importer = userData?.user?.id ?? null;
      let inserted = 0;

      for (let i = 0; i < preview.rows.length; i += CHUNK) {
        const batch = preview.rows.slice(i, i + CHUNK).map((r) => ({
          ...r,
          restaurant_id: storeId,
          source: "deputy",
          imported_by: importer,
        }));
        // Re-importing an overlapping export is normal — ignore rows already held.
        const { error, count } = await supabase
          .from("roster_archive")
          .upsert(batch, { ignoreDuplicates: true, count: "exact" });
        if (error) throw error;
        inserted += count ?? 0;
      }

      const { data: linked } = await supabase.rpc("link_roster_archive_employees", {
        p_restaurant_id: storeId,
      });

      toast.success(`Imported ${inserted} shifts · matched ${linked ?? 0} to team members`);
      setPreview(null);
      qc.invalidateQueries({ queryKey: ["roster-archive-summary"] });
    } catch (e) {
      toast.error((e as { message?: string })?.message || "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const unmapped = preview
    ? (Object.entries(preview.mapped) as [string, string | null][])
        .filter(([, v]) => v === null)
        .map(([k]) => k)
    : [];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">Import historical rosters</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Export <strong>Roster</strong> as CSV from Deputy's Data Exporter over whatever date
          range you want, then drop the file here. Imported rosters are reference only — they
          never touch live rostering, labour projections, or timesheets.
        </p>
        <a
          href="https://service-proxy.deputy.com/exporter/"
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          Open Deputy Data Exporter <ExternalLink className="h-3.5 w-3.5" />
        </a>

        {summary && summary.total > 0 && (
          <div className="mt-3 flex flex-wrap gap-4 border-t border-border pt-3 text-sm">
            <span className="text-muted-foreground">
              <strong className="text-foreground">{summary.total.toLocaleString()}</strong> shifts archived
            </span>
            {summary.from && summary.to && (
              <span className="text-muted-foreground">
                {format(parseISO(summary.from), "MMM yyyy")} – {format(parseISO(summary.to), "MMM yyyy")}
              </span>
            )}
            {summary.unlinked > 0 && (
              <span className="text-warning">{summary.unlinked} not matched to a team member</span>
            )}
          </div>
        )}
      </div>

      {!preview ? (
        <label
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl",
            "border-2 border-dashed border-border bg-card py-12 text-center hover:bg-accent"
          )}
        >
          <Upload className="h-6 w-6 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Choose a Deputy roster CSV</span>
          <span className="text-xs text-muted-foreground">Nothing is saved until you review it</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
        </label>
      ) : (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
              <CheckCircle2 className="h-4 w-4" /> {preview.rows.length} shifts ready
            </span>
            {preview.skipped.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-warning">
                <AlertTriangle className="h-4 w-4" /> {preview.skipped.length} skipped
              </span>
            )}
          </div>

          {unmapped.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              <p className="font-medium text-warning">
                Columns not found: {unmapped.join(", ")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Headers in your file: {preview.headers.join(" · ")}
              </p>
            </div>
          )}

          {preview.skipped.length > 0 && (
            <details className="rounded-lg border border-border p-3 text-sm">
              <summary className="cursor-pointer font-medium text-foreground">
                Why {preview.skipped.length} rows were skipped
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {preview.skipped.slice(0, 20).map((s) => (
                  <li key={s.line}>Line {s.line}: {s.reason}</li>
                ))}
                {preview.skipped.length > 20 && <li>…and {preview.skipped.length - 20} more</li>}
              </ul>
            </details>
          )}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Team member</th>
                  <th className="px-3 py-2">Area</th>
                  <th className="px-3 py-2">Times</th>
                  <th className="px-3 py-2">Break</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.rows.slice(0, 8).map((r, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">{format(parseISO(r.work_date), "EEE d MMM yy")}</td>
                    <td className="px-3 py-2">{r.employee_name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.area_name ?? "—"}</td>
                    <td className="px-3 py-2">
                      {format(new Date(r.start_time), "HH:mm")}–{format(new Date(r.end_time), "HH:mm")}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.mealbreak_minutes ? `${r.mealbreak_minutes}m` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 8 && (
            <p className="text-xs text-muted-foreground">
              Showing the first 8 of {preview.rows.length}. Check these look right before importing.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <select
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">Import into…</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button
              onClick={doImport}
              disabled={busy || !storeId}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Import {preview.rows.length} shifts
            </button>
            <button
              onClick={() => setPreview(null)}
              className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
