import { useEffect } from "react";
import { useActiveBrand } from "@/hooks/useActiveBrand";
import { hexToHslTriplet, DEFAULT_BRAND_COLOR } from "@/lib/brand";

/**
 * Applies the active brand's accent colour to the app by overriding the
 * `--primary` / `--brand-gold` CSS custom properties on <html>. Renders nothing.
 */
export function BrandTheme() {
  const { color } = useActiveBrand();

  useEffect(() => {
    const root = document.documentElement;
    const triplet = hexToHslTriplet(color || DEFAULT_BRAND_COLOR);
    if (triplet) {
      root.style.setProperty("--primary", triplet);
      root.style.setProperty("--brand-gold", triplet);
      root.style.setProperty("--ring", triplet);
    }
    return () => {
      // Clear overrides so the stylesheet default applies again.
      root.style.removeProperty("--primary");
      root.style.removeProperty("--brand-gold");
      root.style.removeProperty("--ring");
    };
  }, [color]);

  return null;
}
