import { ChevronDown } from "lucide-react";
import { useState, useRef, useEffect, createElement } from "react";
import { useBrands } from "@/hooks/useBrands";
import { useSelectedBrand } from "@/hooks/useSelectedBrand";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { brandIcon } from "@/lib/brand";
import { cn } from "@/lib/utils";

export function BrandSwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: brands = [] } = useBrands();
  const { selectedBrandId, setSelectedBrand } = useSelectedBrand();
  const { setSelectedRestaurant } = useSelectedRestaurant();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Nothing to switch between until there are at least two brands.
  if (brands.length < 2) return null;

  const selected = brands.find((b) => b.id === selectedBrandId);

  const choose = (id: string | null) => {
    setSelectedBrand(id);
    // Selected venue may not belong to the new brand — reset to the brand-wide view.
    setSelectedRestaurant(null);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-2 rounded-lg border border-border-strong bg-card px-3 py-[7px] text-[13px] font-medium text-secondary-foreground transition-colors hover:bg-accent"
      >
        {createElement(brandIcon(selected?.icon), {
          className: "h-4 w-4",
          style: { color: selected?.color ?? undefined },
        })}
        <span className="max-w-[140px] truncate">{selected?.name ?? "All Brands"}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-popover p-1 shadow-popover">
          <button
            onClick={() => choose(null)}
            className={cn(
              "flex w-full items-center rounded-md px-3 py-2 text-sm transition-colors",
              !selectedBrandId
                ? "bg-primary/10 text-primary font-medium"
                : "text-popover-foreground hover:bg-accent"
            )}
          >
            All Brands
          </button>
          {brands.map((b) => {
            const Icon = brandIcon(b.icon);
            return (
              <button
                key={b.id}
                onClick={() => choose(b.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  selectedBrandId === b.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-popover-foreground hover:bg-accent"
                )}
              >
                <Icon className="h-4 w-4" style={{ color: b.color }} />
                <span className="truncate">{b.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
