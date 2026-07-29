import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SelectedRestaurantState {
  // The set of venues the user is viewing. Empty = all accessible venues.
  selectedRestaurantIds: string[];
  // Backward-compatible single-venue value: the id when exactly one venue is
  // selected, otherwise null (0 or 2+ selected → "all"/"multiple"). Existing
  // single-venue screens (data entry, P&L basis, etc.) keep reading this.
  selectedRestaurantId: string | null;

  setSelectedRestaurant: (id: string | null) => void;
  setSelectedRestaurants: (ids: string[]) => void;
  toggleRestaurant: (id: string) => void;
}

const singleFrom = (ids: string[]): string | null =>
  ids.length === 1 ? ids[0] : null;

export const useSelectedRestaurant = create<SelectedRestaurantState>()(
  persist(
    (set) => ({
      selectedRestaurantIds: [],
      selectedRestaurantId: null,

      setSelectedRestaurant: (id) =>
        set({
          selectedRestaurantIds: id ? [id] : [],
          selectedRestaurantId: id ?? null,
        }),

      setSelectedRestaurants: (ids) =>
        set({ selectedRestaurantIds: ids, selectedRestaurantId: singleFrom(ids) }),

      toggleRestaurant: (id) =>
        set((s) => {
          const ids = s.selectedRestaurantIds.includes(id)
            ? s.selectedRestaurantIds.filter((x) => x !== id)
            : [...s.selectedRestaurantIds, id];
          return { selectedRestaurantIds: ids, selectedRestaurantId: singleFrom(ids) };
        }),
    }),
    {
      name: "the-coop-selected-restaurant",
      partialize: (s) => ({ selectedRestaurantIds: s.selectedRestaurantIds }),
      // Rebuild state on load, upgrading the legacy single-id shape if present.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SelectedRestaurantState>;
        const ids =
          p.selectedRestaurantIds ??
          (p.selectedRestaurantId ? [p.selectedRestaurantId] : []);
        return { ...current, selectedRestaurantIds: ids, selectedRestaurantId: singleFrom(ids) };
      },
    }
  )
);
