import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SelectedBrandState {
  // null = all brands
  selectedBrandId: string | null;
  setSelectedBrand: (id: string | null) => void;
}

export const useSelectedBrand = create<SelectedBrandState>()(
  persist(
    (set) => ({
      selectedBrandId: null,
      setSelectedBrand: (id) => set({ selectedBrandId: id }),
    }),
    {
      name: "the-coop-selected-brand",
    }
  )
);
