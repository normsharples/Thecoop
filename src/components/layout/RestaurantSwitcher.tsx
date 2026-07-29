import { ChevronDown, Store, Check } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";

export function RestaurantSwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: restaurants, isLoading } = useRestaurants();
  const { selectedRestaurantIds, setSelectedRestaurants, toggleRestaurant } =
    useSelectedRestaurant();
  const { isSuperadmin } = usePermissions();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedCount = selectedRestaurantIds.length;
  const displayName =
    selectedCount === 0
      ? "All Restaurants"
      : selectedCount === 1
        ? restaurants?.find((r) => r.id === selectedRestaurantIds[0])?.name ?? "1 venue"
        : `${selectedCount} venues`;

  if (isLoading) {
    return <div className="h-9 w-48 rounded-lg bg-muted/30 animate-pulse" />;
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
      >
        <Store className="h-4 w-4 text-muted-foreground" />
        <span className="max-w-[160px] truncate">{displayName}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-60 rounded-lg border border-border bg-popover p-1 shadow-md">
          {isSuperadmin && (
            <button
              onClick={() => setSelectedRestaurants([])}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                selectedCount === 0
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-popover-foreground hover:bg-accent"
              )}
            >
              <span className="flex h-4 w-4 items-center justify-center">
                {selectedCount === 0 && <Check className="h-3.5 w-3.5" />}
              </span>
              All Restaurants
            </button>
          )}

          {selectedCount > 0 && (
            <div className="flex items-center justify-between px-3 py-1">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {selectedCount} selected
              </span>
              <button
                onClick={() => setSelectedRestaurants([])}
                className="text-[11px] text-primary hover:underline"
              >
                Clear
              </button>
            </div>
          )}

          <div className="max-h-72 overflow-y-auto">
            {restaurants?.map((restaurant) => {
              const checked = selectedRestaurantIds.includes(restaurant.id);
              return (
                <button
                  key={restaurant.id}
                  onClick={() => toggleRestaurant(restaurant.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                    checked
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-popover-foreground hover:bg-accent"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded border",
                      checked ? "border-primary bg-primary text-primary-foreground" : "border-border"
                    )}
                  >
                    {checked && <Check className="h-3 w-3" />}
                  </span>
                  <span className="truncate">{restaurant.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
