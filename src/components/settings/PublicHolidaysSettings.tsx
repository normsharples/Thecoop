import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Plus, Trash2, Loader2, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

const STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"] as const;

interface Holiday {
  id: string;
  date: string;
  state: string;
  name: string;
}

const inputCls =
  "h-9 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

export default function PublicHolidaysSettings() {
  const qc = useQueryClient();
  const thisYear = Number(format(new Date(), "yyyy"));
  const [year, setYear] = useState(thisYear);
  const [stateCode, setStateCode] = useState<string>("VIC");
  const [newDate, setNewDate] = useState("");
  const [newName, setNewName] = useState("");

  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["ph-admin", stateCode, year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("public_holidays")
        .select("*")
        .eq("state", stateCode)
        .gte("date", from)
        .lte("date", to)
        .order("date");
      if (error) throw error;
      return (data ?? []) as Holiday[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ph-admin"] });
    qc.invalidateQueries({ queryKey: ["public-holidays"] });
  };

  const add = useMutation({
    mutationFn: async () => {
      if (!newDate || !newName.trim()) throw new Error("Enter a date and a name");
      const { error } = await supabase
        .from("public_holidays")
        .insert({ date: newDate, state: stateCode, name: newName.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewDate("");
      setNewName("");
      invalidate();
      toast.success("Holiday added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("public_holidays").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Holiday removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <div className="flex items-center gap-2">
        <CalendarClock className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">Public holidays</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Drives public-holiday penalty rates. Confirm each year — regional and provisional dates
        (e.g. AFL Grand Final Friday) can change.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select value={stateCode} onChange={(e) => setStateCode(e.target.value)} className={inputCls}>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={inputCls}>
          {[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No holidays set for {stateCode} {year}.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((h) => (
              <li key={h.id} className="flex items-center justify-between px-4 py-2">
                <div>
                  <span className="text-sm font-medium text-foreground">
                    {format(parseISO(h.date), "EEE d MMM yyyy")}
                  </span>
                  <span className="ml-2 text-sm text-muted-foreground">{h.name}</span>
                </div>
                <button
                  onClick={() => remove.mutate(h.id)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title="Remove"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* Add row */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/20 p-3">
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className={inputCls}
          />
          <input
            type="text"
            placeholder="Holiday name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className={inputCls + " min-w-[180px] flex-1"}
          />
          <button
            onClick={() => add.mutate()}
            disabled={add.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
      </div>
    </div>
  );
}
