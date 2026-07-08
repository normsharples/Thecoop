import { ChevronDown, Store } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { usePermissions } from "@/hooks/usePermissions";

export function RestaurantSwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: restaurants, isLoading } = useRestaurants();
  const { selectedRestaurantId, setSelectedRestaurant } = useSelectedRestaurant();
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

  const selectedRestaurant = restaurants?.find((r) => r.id === selectedRestaurantId);
  const displayName = selectedRestaurant?.name ?? "All Restaurants";

  if (isLoading) {
    return (
      <div className="h-9 w-48 rounded-lg bg-muted/30 animate-pulse" />
    );
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
        <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-lg border border-border bg-popover p-1 shadow-md">
          {isSuperadmin && (
            <button
              onClick={() => {
                setSelectedRestaurant(null);
                setOpen(false);
              }}
              className={`flex w-full items-center rounded-md px-3 py-2 text-sm transition-colors ${
                !selectedRestaurantId
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-popover-foreground hover:bg-accent"
              }`}
            >
              All Restaurants
            </button>
          )}
          {restaurants?.map((restaurant) => (
            <button
              key={restaurant.id}
              onClick={() => {
                setSelectedRestaurant(restaurant.id);
                setOpen(false);
              }}
              className={`flex w-full items-center rounded-md px-3 py-2 text-sm transition-colors ${
                selectedRestaurantId === restaurant.id
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-popover-foreground hover:bg-accent"
              }`}
            >
              {restaurant.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
