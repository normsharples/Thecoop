import { createContext, useContext, type ReactNode } from "react";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";

/**
 * Lets a single dashboard widget look at a different set of venues from the
 * page-level venue picker.
 *
 * Dashboard cards call `useScopedRestaurantIds()` where they used to read
 * `selectedRestaurantIds` straight off the store. Outside a <WidgetScope>, or
 * when the widget follows the page, it returns exactly what the store holds —
 * so the cards behave the same anywhere else they're used.
 */
const WidgetScopeContext = createContext<string[] | null>(null);

export function WidgetScope({
  restaurantIds,
  children,
}: {
  /** null / empty = follow the page selection. */
  restaurantIds: string[] | null | undefined;
  children: ReactNode;
}) {
  const value = restaurantIds && restaurantIds.length ? restaurantIds : null;
  return <WidgetScopeContext.Provider value={value}>{children}</WidgetScopeContext.Provider>;
}

/** The venue selection a dashboard card should use. Empty = all accessible. */
export function useScopedRestaurantIds(): string[] {
  const override = useContext(WidgetScopeContext);
  const { selectedRestaurantIds } = useSelectedRestaurant();
  return override ?? selectedRestaurantIds;
}
