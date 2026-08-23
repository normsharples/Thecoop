import { useEffect } from "react";
import { useActiveBrand } from "@/hooks/useActiveBrand";
import { hexToHslTriplet, DEFAULT_BRAND_COLOR } from "@/lib/brand";

/**
 * Publishes the active brand's colour as `--brand-accent`.
 *
 * It deliberately does NOT touch `--primary` / `--ring` any more. The redesign
 * fixes the app chrome to the navy/teal system, so switching brand recolours
 * the brand mark and nothing else — buttons, focus rings, charts and status
 * colours stay put. Reach for `brand-accent` only where the brand itself is
 * the subject (logo, brand switcher, store identity chips).
 */
export function BrandTheme() {
  const { color } = useActiveBrand();

  useEffect(() => {
    const root = document.documentElement;
    const triplet = hexToHslTriplet(color || DEFAULT_BRAND_COLOR);
    if (triplet) {
      root.style.setProperty("--brand-accent", triplet);
    }
    return () => {
      root.style.removeProperty("--brand-accent");
    };
  }, [color]);

  return null;
}
