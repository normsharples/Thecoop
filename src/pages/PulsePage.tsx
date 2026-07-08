import { useState } from "react";
import { format, subDays, parseISO } from "date-fns";
import { RefreshCw, Activity } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { usePulseData } from "@/hooks/usePulseData";
import { useRestaurants } from "@/hooks/useRestaurants";
import PulseGrid from "@/components/pulse/PulseGrid";

const todayStr = format(new Date(), "yyyy-MM-dd");
const yesterdayStr = format(subDays(new Date(), 1), "yyyy-MM-dd");

export default function PulsePage() {
  const queryClient = useQueryClient();
  const { data: restaurants = [], isLoading: restaurantsLoading } = useRestaurants();

  // null = All Stores, string = specific restaurant id
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pulseDate, setPulseDate] = useState(yesterdayStr);

  const displayDate = format(parseISO(pulseDate), "EEEE d MMMM yyyy");

  const { data, isLoading, isFetching } = usePulseData(selectedId, pulseDate);

  const vitals = data?.vitals ?? [];
  const perStore = data?.perStore ?? null;

  const loading = isLoading || restaurantsLoading;

  async function handleRefresh() {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ["pulse"] });
    setTimeout(() => setIsRefreshing(false), 600);
  }

  return (
    // Full-bleed dark background — escapes AppLayout's padding
    <div
      className="-mx-4 -my-4 lg:-mx-6 lg:-my-6 min-h-[calc(100vh-4rem)]"
      style={{ background: "hsl(220, 20%, 6%)" }}
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-10 border-b border-slate-800"
        style={{ background: "hsl(220, 20%, 7%)" }}
      >
        <div className="px-4 lg:px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
          {/* Title */}
          <div className="flex items-center gap-2 shrink-0">
            <Activity className="h-5 w-5 text-green-400" />
            <span className="text-sm font-semibold text-slate-200">Pulse Report</span>
          </div>

          {/* Date picker */}
          <div className="flex items-center gap-1.5 sm:mr-auto">
            <button
              onClick={() => setPulseDate(yesterdayStr)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                pulseDate === yesterdayStr
                  ? "bg-slate-700 text-white"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
              )}
            >
              Yesterday
            </button>
            <input
              type="date"
              value={pulseDate}
              max={todayStr}
              onChange={(e) => e.target.value && setPulseDate(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-slate-600"
            />
            <span className="hidden sm:block text-xs text-slate-500">
              {displayDate}
            </span>
          </div>

          {/* Restaurant tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5 sm:pb-0">
            <button
              onClick={() => setSelectedId(null)}
              className={cn(
                "whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                selectedId === null
                  ? "bg-slate-700 text-white"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
              )}
            >
              All Stores
            </button>
            {restaurants.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={cn(
                  "whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  selectedId === r.id
                    ? "bg-slate-700 text-white"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                )}
              >
                {r.name.replace("Pollo ", "")}
              </button>
            ))}
          </div>

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || isFetching}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40"
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5",
                (isRefreshing || isFetching) && "animate-spin"
              )}
            />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {/* Mobile date */}
        <div className="px-4 pb-3 sm:hidden">
          <p className="text-xs text-slate-500">{displayDate}</p>
        </div>
      </div>

      {/* ── Grid ──────────────────────────────────────────────────────────── */}
      <div className="px-4 lg:px-6 py-6 pb-24 lg:pb-6">
        <PulseGrid
          vitals={vitals}
          loading={loading}
          perStore={perStore}
          restaurants={restaurants}
          selectedRestaurantId={selectedId}
        />
      </div>
    </div>
  );
}
