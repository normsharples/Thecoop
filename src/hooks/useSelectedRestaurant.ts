import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SelectedRestaurantState {
  selectedRestaurantId: string | null;
  setSelectedRestaurant: (id: string | null) => void;
}

export const useSelectedRestaurant = create<SelectedRestaurantState>()(
  persist(
    (set) => ({
      selectedRestaurantId: null,
      setSelectedRestaurant: (id) => set({ selectedRestaurantId: id }),
    }),
    {
      name: "the-coop-selected-restaurant",
    }
  )
);
