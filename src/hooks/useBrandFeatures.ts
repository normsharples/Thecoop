import { useCallback } from "react";
import { useBrands } from "./useBrands";
import { useActiveBrand } from "./useActiveBrand";
import { classifyPath, isPathEnabledFor } from "@/lib/brandFeatures";

/**
 * Which reports and modules are switched on for the brand in view.
 * See lib/brandFeatures.ts for the rules.
 */
export function useBrandFeatures() {
  const { data: brands = [] } = useBrands();
  const { brand } = useActiveBrand();

  const isPathEnabled = useCallback(
    (path: string) => isPathEnabledFor(path, brand, brands),
    [brand, brands]
  );

  return { isPathEnabled, classifyPath, brand };
}
