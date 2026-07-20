import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2, Store, Wallet, Calendar,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { format, subDays, parseISO } from "date-fns";
import { supabase } from "@/lib/supabase";
import { formatCurrency, cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PayoutRow {
  venue: string;
  channel: string;
  date: string;
  payout_amount: number;
}

// ─── Store / channel config ──────────────────────────────────────────────────

const STORES: {
  venue: string;
  label: string;
  channels: string[];
  color: typeof STORE_COLORS[0];
}[] = [
  {
    venue: "Pollo",
    label: "Pollo (Geelong West)",
    channels: ["Lightspeed", "Uber Eats", "DoorDash", "Bite"],
    color: {
      gradient: "from-orange-500 to-amber-500",
      bg: "bg-orange-500/10",
      text: "text-orange-500",
      border: "border-orange-500/30",
      badge: "bg-orange-500/15 text-orange-600",
    },
  },
  {
    venue: "Pollo - Torquay",
    label: "Pollo - Torquay",
    channels: ["Lightspeed", "Uber Eats", "Bite"],
    color: {
      gradient: "from-blue-500 to-indigo-500",
      bg: "bg-blue-500/10",
      text: "text-blue-500",
      border: "border-blue-500/30",
      badge: "bg-blue-500/15 text-blue-600",
    },
  },
];

const STORE_COLORS = [
  {
    gradient: "from-orange-500 to-amber-500",
    bg: "bg-orange-500/10",
    text: "text-orange-500",
    border: "border-orange-500/30",
    badge: "bg-orange-500/15 text-orange-600",
  },
  {
    gradient: "from-blue-500 to-indigo-500",
    bg: "bg-blue-500/10",
    text: "text-blue-500",
    border: "border-blue-500/30",
    badge: "bg-blue-500/15 text-blue-600",
  },
];

const CHANNEL_ICONS: Record<string, string> = {
  Lightspeed: "⚡",
  "Uber Eats": "🟢",
  DoorDash: "🔴",
  Bite: "🟡",
};

// ─── Main component ──────────────────────────────────────────────────────────

export default function PayoutReport() {
  const [selectedDate, setSelectedDate] = useState(() =>
    format(subDays(new Date(), 1), "yyyy-MM-dd")
  );

  const { data: rows, isLoading } = useQuery({
    queryKey: ["channel-payouts", selectedDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("channel_payouts")
        .select("venue, channel, date, payout_amount")
        .eq("date", selectedDate);
      if (error) throw error;
      return (data ?? []) as PayoutRow[];
    },
  });

  const storeData = useMemo(() => {
    if (!rows) return [];
    return STORES.map((store) => {
      const channelPayouts = store.channels.map((ch) => {
        const row = rows.find(
          (r) => r.venue === store.venue && r.channel === ch
        );
        return { channel: ch, amount: row?.payout_amount ?? null };
      });
      const storeTotal = channelPayouts.reduce(
        (sum, cp) => sum + (cp.amount ?? 0),
        0
      );
      const hasData = channelPayouts.some((cp) => cp.amount !== null);
      return { ...store, channelPayouts, storeTotal, hasData };
    });
  }, [rows]);

  const grandTotal = useMemo(
    () => storeData.reduce((sum, s) => sum + s.storeTotal, 0),
    [storeData]
  );

  const hasAnyData = storeData.some((s) => s.hasData);

  function shiftDate(days: number) {
    setSelectedDate((prev) =>
      format(
        days > 0 ? subDays(parseISO(prev), -days) : subDays(parseISO(prev), Math.abs(days)),
        "yyyy-MM-dd"
      )
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Date selector ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => shiftDate(-1)}
          className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-transparent text-sm font-medium text-foreground outline-none"
          />
        </div>

        <button
          onClick={() => shiftDate(1)}
          className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        <span className="text-sm text-muted-foreground">
          {format(parseISO(selectedDate), "EEEE, d MMMM yyyy")}
        </span>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {/* No data */}
      {!isLoading && !hasAnyData && (
        <div className="rounded-xl border border-border bg-card p-12 flex flex-col items-center text-center">
          <Wallet className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-base font-semibold mb-2">No payout data</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            No payouts have been recorded for this date. The daily sync runs at
            2 AM — data will appear once it completes.
          </p>
        </div>
      )}

      {!isLoading && hasAnyData && (
        <>
          {/* ── Grand total banner ─────────────────────────────────────── */}
          <div className="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 via-card to-teal-500/5 p-6">
            <div className="flex items-center gap-2 mb-3">
              <Wallet className="h-5 w-5 text-emerald-500" />
              <h3 className="text-sm font-semibold text-foreground">
                Total Payouts
              </h3>
            </div>
            <p className="text-4xl font-bold text-emerald-500 tabular-nums tracking-tight">
              {formatCurrency(grandTotal)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Across all stores &amp; channels
            </p>
          </div>

          {/* ── Per-store cards ─────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {storeData.map((store) => (
              <div
                key={store.venue}
                className={cn(
                  "relative overflow-hidden rounded-xl border bg-card",
                  store.color.border
                )}
              >
                {/* Accent bar */}
                <div
                  className={cn(
                    "absolute top-0 left-0 right-0 h-1 bg-gradient-to-r",
                    store.color.gradient
                  )}
                />

                <div className="p-6 space-y-4">
                  {/* Store header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={cn("rounded-lg p-2", store.color.bg)}>
                        <Store className={cn("h-4 w-4", store.color.text)} />
                      </div>
                      <h3 className="text-sm font-semibold text-foreground">
                        {store.label}
                      </h3>
                    </div>
                    <p
                      className={cn(
                        "text-2xl font-bold tabular-nums",
                        store.color.text
                      )}
                    >
                      {formatCurrency(store.storeTotal)}
                    </p>
                  </div>

                  {/* Channel breakdown */}
                  <div className="space-y-2 pt-3 border-t border-border">
                    {store.channelPayouts.map((cp) => (
                      <div
                        key={cp.channel}
                        className="flex items-center justify-between py-1.5"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm">
                            {CHANNEL_ICONS[cp.channel] ?? "⚪"}
                          </span>
                          <span className="text-sm text-foreground">
                            {cp.channel}
                          </span>
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-foreground">
                          {cp.amount !== null
                            ? formatCurrency(cp.amount)
                            : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
