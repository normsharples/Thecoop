import {
  Bird,
  Beef,
  Drumstick,
  Pizza,
  Coffee,
  Utensils,
  Fish,
  Salad,
  Sandwich,
  Soup,
  IceCream,
  Croissant,
  Store,
  type LucideIcon,
} from "lucide-react";

// Curated set of brand icons users can pick from in Brand settings.
export const BRAND_ICONS: Record<string, LucideIcon> = {
  Bird,
  Beef,
  Drumstick,
  Pizza,
  Coffee,
  Utensils,
  Fish,
  Salad,
  Sandwich,
  Soup,
  IceCream,
  Croissant,
  Store,
};

export const BRAND_ICON_KEYS = Object.keys(BRAND_ICONS);

export const DEFAULT_BRAND_COLOR = "#C9A84C"; // Pollo gold
export const DEFAULT_BRAND_ICON = "Bird";
export const DEFAULT_BRAND_NAME = "The Coop";

export function brandIcon(key: string | null | undefined): LucideIcon {
  return (key && BRAND_ICONS[key]) || Bird;
}

/**
 * Convert a hex colour (#RGB or #RRGGBB) to an "H S% L%" triplet string,
 * matching the format the app's CSS custom properties expect
 * (e.g. `--primary: 44 54% 54%`).
 */
export function hexToHslTriplet(hex: string): string | null {
  if (!hex) return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;

  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let hue = 0;
  let sat = 0;
  const light = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    sat = light > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        hue = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        hue = (b - r) / d + 2;
        break;
      default:
        hue = (r - g) / d + 4;
    }
    hue /= 6;
  }

  const H = Math.round(hue * 360);
  const S = Math.round(sat * 100);
  const L = Math.round(light * 100);
  return `${H} ${S}% ${L}%`;
}
