import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Printer, PrintJob } from "@/types";

/**
 * Printers and the label queue (migration 076).
 *
 * Nothing here talks to a printer. The app only ever writes a row; the print
 * worker inside refresh-watcher on the Mac drains the queue and writes ESC/POS
 * to the printer's socket. That's what makes labels work from the kitchen
 * tablet and a phone as well as from a desk.
 */

export function usePrinters(restaurantId: string | null) {
  return useQuery<Printer[]>({
    queryKey: ["printers", restaurantId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("printers").select("*").order("name");
      if (restaurantId) q = q.eq("restaurant_id", restaurantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Printer[];
    },
  });
}

export function useSavePrinter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: Partial<Printer> & { restaurant_id: string; name: string }) => {
      // One default per venue is enforced by a unique index, so clear the old
      // one first rather than letting the insert fail.
      if (row.is_default) {
        await supabase
          .from("printers")
          .update({ is_default: false })
          .eq("restaurant_id", row.restaurant_id)
          .neq("id", row.id ?? "00000000-0000-0000-0000-000000000000");
      }
      const { error } = await supabase
        .from("printers")
        .upsert({ ...row, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["printers"] }),
  });
}

export function useDeletePrinter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("printers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["printers"] }),
  });
}

/** Recent jobs, newest first — the queue's health at a glance. */
export function usePrintJobs(restaurantId: string | null, limit = 20) {
  return useQuery<PrintJob[]>({
    queryKey: ["print-jobs", restaurantId ?? "all", limit],
    queryFn: async () => {
      let q = supabase
        .from("print_jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (restaurantId) q = q.eq("restaurant_id", restaurantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as PrintJob[];
    },
    // A queued job should clear within a poll of the watcher; keep the view
    // moving while anything is outstanding.
    refetchInterval: (query) => {
      const rows = query.state.data as PrintJob[] | undefined;
      return rows?.some((j) => j.status === "queued" || j.status === "printing") ? 3000 : false;
    },
  });
}

export function useTestPrint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (restaurantId: string) => {
      const { data, error } = await supabase.rpc("print_test_label", {
        p_restaurant_id: restaurantId,
      });
      if (error) throw error;
      if (!data) throw new Error("No printer set up for this venue yet.");
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["print-jobs"] }),
  });
}

/** Queue another copy of a batch's label. */
export function useReprintRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const { data, error } = await supabase.rpc("reprint_production_run", {
        p_run_id: runId,
      });
      if (error) throw error;
      if (!data) throw new Error("No printer set up for this venue yet.");
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["print-jobs"] }),
  });
}
