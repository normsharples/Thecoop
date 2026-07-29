import { useMemo } from "react";
import { useBrands } from "./useBrands";
import { useSelectedBrand } from "./useSelectedBrand";
import { useSelectedRestaurant } from "./useSelectedRestaurant";
import { useRestaurants } from "./useRestaurants";
import {
  brandIcon,
  DEFAULT_BRAND_COLOR,
  DEFAULT_BRAND_NAME,
} from "@/lib/brand";
import type { Brand } from "@/types";

/**
 * Resolves the brand that should style the app right now:
 *   1. an explicitly selected brand, else
 *   2. the brand of the currently selected venue, else
 *   3. the only brand (if there's exactly one), else
 *   4. none → the neutral "The Coop" look.
 */
export function useActiveBrand() {
  const { data: brands = [] } = useBrands();
  const { selectedBrandId } = useSelectedBrand();
  const { selectedRestaurantId } = useSelectedRestaurant();
  const { data: restaurants = [] } = useRestaurants();

  const brand = useMemo<Brand | null>(() => {
    if (selectedBrandId) {
      return brands.find((b) => b.id === selectedBrandId) ?? null;
    }
    if (selectedRestaurantId) {
      const venue = restaurants.find((r) => r.id === selectedRestaurantId);
      if (venue?.brand_id) {
        return brands.find((b) => b.id === venue.brand_id) ?? null;
      }
    }
    if (brands.length === 1) return brands[0];
    return null;
  }, [brands, selectedBrandId, selectedRestaurantId, restaurants]);

  return {
    brand,
    name: brand?.name ?? DEFAULT_BRAND_NAME,
    color: brand?.color ?? DEFAULT_BRAND_COLOR,
    Icon: brandIcon(brand?.icon),
  };
}
