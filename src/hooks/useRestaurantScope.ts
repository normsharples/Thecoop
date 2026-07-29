import { useMemo } from "react";
import { useSelectedRestaurant } from "./useSelectedRestaurant";
import { useRestaurants } from "./useRestaurants";

/**
 * Resolves the effective set of venue ids to filter data by, honouring a
 * multi-venue selection.
 *
 *   ids      – venues to query: the selected subset, or all accessible venues
 *              when nothing specific is selected.
 *   allIds   – every accessible venue id (respects brand filter + permissions).
 *   isAll    – true when no specific subset is selected (viewing everything).
 *   isSingle – true when exactly one venue is in view (hide the "Venue" column).
 *   count    – number of explicitly selected venues (0 = all).
 *   key      – stable string for react-query keys ("all" or sorted id list).
 */
export function useRestaurantScope() {
  const { selectedRestaurantIds } = useSelectedRestaurant();
  const { data: restaurants = [] } = useRestaurants();

  return useMemo(() => {
    const allIds = restaurants.map((r) => r.id);
    const selected = selectedRestaurantIds;
    const isAll = selected.length === 0;
    const ids = isAll ? allIds : selected;
    return {
      ids,
      allIds,
      isAll,
      isSingle: selected.length === 1,
      singleId: selected.length === 1 ? selected[0] : null,
      count: selected.length,
      key: isAll ? "all" : [...selected].sort().join(","),
    };
  }, [restaurants, selectedRestaurantIds]);
}
