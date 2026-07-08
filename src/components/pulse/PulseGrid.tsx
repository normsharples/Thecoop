import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { VitalCard, VitalDot, PulseSpinner } from "@/components/pulse/VitalCard";
import type { VitalData } from "@/hooks/usePulseData";
import type { Restaurant } from "@/types";

interface PulseGridProps {
  vitals: VitalData[];
  loading: boolean;
  perStore?: { restaurantId: string; vitals: VitalData[] }[] | null;
  restaurants: Restaurant[];
  selectedRestaurantId: string | null;
}

export default function PulseGrid({
  vitals,
  loading,
  perStore,
  restaurants,
  selectedRestaurantId,
}: PulseGridProps) {
  const navigate = useNavigate();

  if (loading) return <PulseSpinner />;

  const liveVitals = vitals.slice(0, 7);
  const placeholders = vitals.slice(7);

  function handleVitalClick(vital: VitalData) {
    if (!vital.isPlaceholder && vital.reportPath) {
      const params = new URLSearchParams();
      if (selectedRestaurantId) params.set("restaurant", selectedRestaurantId);
      navigate(`${vital.reportPath}?${params.toString()}`);
    }
  }

  return (
    <div className="space-y-8">
      {/* Live vitals grid */}
      <div>
        <p className="text-xs font-semibold tracking-widest uppercase text-slate-500 mb-4 px-1">
          Live Metrics
        </p>
        <div
          className={cn(
            "grid gap-4",
            "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          )}
        >
          {liveVitals.map((vital) => (
            <VitalCard
              key={vital.id}
              label={vital.label}
              value={vital.value}
              target={vital.target}
              status={vital.status}
              trend={vital.trend}
              trendValue={vital.trendValue}
              subtitle={vital.subtitle}
              onClick={() => handleVitalClick(vital)}
            />
          ))}
        </div>
      </div>

      {/* Placeholder vitals */}
      <div>
        <p className="text-xs font-semibold tracking-widest uppercase text-slate-600 mb-4 px-1">
          Coming Soon
        </p>
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {placeholders.map((vital) => (
            <VitalCard
              key={vital.id}
              label={vital.label}
              value={vital.value}
              status={vital.status}
              subtitle={vital.subtitle}
              isPlaceholder
            />
          ))}
        </div>
      </div>

      {/* All Stores per-store breakdown */}
      {perStore && perStore.length > 1 && (
        <div>
          <p className="text-xs font-semibold tracking-widest uppercase text-slate-500 mb-4 px-1">
            By Store
          </p>
          <div className="space-y-3">
            {perStore.map(({ restaurantId, vitals: storeVitals }) => {
              const restaurant = restaurants.find((r) => r.id === restaurantId);
              return (
                <div
                  key={restaurantId}
                  className="rounded-xl border border-slate-800 bg-[hsl(220,20%,9%)] px-5 py-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <p className="text-sm font-semibold text-slate-300 w-40 flex-shrink-0 truncate">
                      {restaurant?.name ?? "Unknown"}
                    </p>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      {storeVitals.map((v) => (
                        <VitalDot key={v.id} status={v.status} label={v.label} />
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
