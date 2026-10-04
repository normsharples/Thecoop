import type { ReactNode } from "react";
import {
  AlertTriangle, BarChart3, CalendarClock, ExternalLink, Gauge, LayoutDashboard,
  LineChart, Smartphone, Star, Truck, type LucideIcon,
} from "lucide-react";
import { AlertsBanner } from "@/components/dashboard/AlertsBanner";
import { DailySnapshot } from "@/components/dashboard/DailySnapshot";
import { DailySecondaryCards } from "@/components/dashboard/DailySecondaryCards";
import { QuickStatsCards } from "@/components/dashboard/QuickStatsCards";
import { WeeklySnapshot } from "@/components/dashboard/WeeklySnapshot";
import { WeeklyStatsCards } from "@/components/dashboard/WeeklyStatsCards";
import { WeeklySecondaryCards } from "@/components/dashboard/WeeklySecondaryCards";
import { ChannelSalesCard } from "@/components/dashboard/ChannelSalesCard";
import { WeeklyRevenueTrend } from "@/components/dashboard/WeeklyRevenueTrend";
import { RecentReviews } from "@/components/dashboard/RecentReviews";
import { QuickLinks } from "@/components/dashboard/QuickLinks";
import { UpcomingCatering } from "@/components/dashboard/UpcomingCatering";

// ============================================================================
// DASHBOARD WIDGETS
// ----------------------------------------------------------------------------
// Every block on the dashboard is a widget. A layout is an ordered list of
// widget instances; each instance has a type (below), a size and settings.
// Adding a new widget = add one entry to WIDGETS. Nothing else changes.
// ============================================================================

export type WidgetSize = "sm" | "md" | "lg" | "full";

export const SIZE_LABEL: Record<WidgetSize, string> = {
  sm: "Small (¼)",
  md: "Medium (½)",
  lg: "Large (¾)",
  full: "Full width",
};

/** Grid span on the 4-column desktop grid; phones collapse to 2 columns. */
export const SIZE_CLASS: Record<WidgetSize, string> = {
  sm: "col-span-1",
  md: "col-span-2",
  lg: "col-span-2 lg:col-span-3",
  full: "col-span-2 lg:col-span-4",
};

export interface WidgetSettings {
  /** Specific venues for this widget. Empty/undefined = follow the page. */
  restaurantIds?: string[];
  /** channel_sales only. */
  channel?: "online_sales" | "delivery_sales";
}

export interface WidgetInstance {
  id: string;
  type: WidgetType;
  size: WidgetSize;
  settings: WidgetSettings;
}

export interface DashboardLayout {
  version: 1;
  widgets: WidgetInstance[];
}

/** The period chosen in the dashboard's controls bar, resolved once. */
export interface DashboardPeriod {
  mode: "daily" | "weekly" | "custom";
  /** Anchor date (daily: the day, weekly: any day in the week, custom: range end). */
  date: string;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  comparisonLabel: string;
}

interface WidgetDef {
  label: string;
  description: string;
  icon: LucideIcon;
  sizes: WidgetSize[];
  defaultSize: WidgetSize;
  /** Can this widget be pinned to specific venues? */
  venueScoped: boolean;
  /** Widget-specific settings it's created with. */
  defaultSettings?: WidgetSettings;
  /** Human label for an instance, e.g. "Channel sales — Delivery". */
  instanceLabel?: (s: WidgetSettings) => string;
  render: (p: DashboardPeriod, s: WidgetSettings) => ReactNode;
}

const CHANNELS = {
  online_sales:   { label: "Web / App Sales", icon: Smartphone },
  delivery_sales: { label: "Delivery Sales",  icon: Truck },
} as const;

export const CHANNEL_OPTIONS = Object.entries(CHANNELS).map(([value, c]) => ({
  value: value as keyof typeof CHANNELS,
  label: c.label,
}));

export const WIDGETS = {
  alerts: {
    label: "Alerts",
    description: "Open alerts that need acknowledging. Hidden when there are none.",
    icon: AlertTriangle,
    sizes: ["md", "lg", "full"],
    defaultSize: "full",
    venueScoped: true,
    render: () => <AlertsBanner />,
  },
  snapshot: {
    label: "Snapshot",
    description: "Headline revenue, labour and rating for the selected period.",
    icon: LayoutDashboard,
    sizes: ["lg", "full"],
    defaultSize: "full",
    venueScoped: true,
    render: (p) =>
      p.mode === "daily" ? (
        <DailySnapshot date={p.date} />
      ) : p.mode === "weekly" ? (
        <WeeklySnapshot date={p.date} />
      ) : (
        <WeeklySnapshot
          date={p.to} from={p.from} to={p.to}
          comparisonLabel={p.comparisonLabel} revenueLabel="Revenue (Net)"
        />
      ),
  },
  secondary: {
    label: "Transactions & labour",
    description: "Transaction count and labour hours against the previous period.",
    icon: Gauge,
    sizes: ["md", "lg", "full"],
    defaultSize: "md",
    venueScoped: true,
    render: (p) => (
      <div className="grid grid-cols-2 gap-4">
        {p.mode === "daily" ? (
          <DailySecondaryCards date={p.date} />
        ) : p.mode === "weekly" ? (
          <WeeklySecondaryCards date={p.date} />
        ) : (
          <WeeklySecondaryCards
            date={p.to} from={p.from} to={p.to} comparisonLabel={p.comparisonLabel}
          />
        )}
      </div>
    ),
  },
  channel_sales: {
    label: "Channel sales",
    description: "Sales for one channel — web/app or delivery.",
    icon: Truck,
    sizes: ["sm", "md"],
    defaultSize: "sm",
    venueScoped: true,
    defaultSettings: { channel: "delivery_sales" },
    instanceLabel: (s) => CHANNELS[s.channel ?? "delivery_sales"].label,
    render: (p, s) => {
      const c = CHANNELS[s.channel ?? "delivery_sales"];
      return (
        <ChannelSalesCard
          label={c.label} field={s.channel ?? "delivery_sales"} icon={c.icon}
          from={p.from} to={p.to} prevFrom={p.prevFrom} prevTo={p.prevTo}
          comparisonLabel={p.comparisonLabel}
        />
      );
    },
  },
  venue_stats: {
    label: "Venue breakdown",
    description: "Per-venue sales, labour and rating cards.",
    icon: BarChart3,
    sizes: ["lg", "full"],
    defaultSize: "full",
    venueScoped: true,
    render: (p) =>
      p.mode === "daily" ? (
        <QuickStatsCards date={p.date} />
      ) : p.mode === "weekly" ? (
        <WeeklyStatsCards date={p.date} />
      ) : (
        <WeeklyStatsCards date={p.to} from={p.from} to={p.to} revenueLabel="Revenue" />
      ),
  },
  revenue_trend: {
    label: "Weekly revenue trend",
    description: "Revenue by week, leading up to the selected period.",
    icon: LineChart,
    sizes: ["md", "lg", "full"],
    defaultSize: "full",
    venueScoped: true,
    render: (p) => <WeeklyRevenueTrend date={p.mode === "custom" ? p.to : p.date} />,
  },
  reviews: {
    label: "Recent reviews",
    description: "Latest Google reviews and the overall rating.",
    icon: Star,
    sizes: ["md", "lg", "full"],
    defaultSize: "full",
    venueScoped: true,
    render: () => <RecentReviews />,
  },
  catering: {
    label: "Upcoming catering",
    description: "Catering orders coming up next.",
    icon: CalendarClock,
    sizes: ["md", "lg", "full"],
    defaultSize: "md",
    venueScoped: true,
    render: () => <UpcomingCatering />,
  },
  quick_links: {
    label: "Quick links",
    description: "Shortcuts to POS, delivery and supplier portals.",
    icon: ExternalLink,
    sizes: ["md", "lg", "full"],
    defaultSize: "full",
    venueScoped: false,
    render: () => <QuickLinks />,
  },
} satisfies Record<string, WidgetDef>;

export type WidgetType = keyof typeof WIDGETS;

export function widgetDef(type: WidgetType): WidgetDef {
  return WIDGETS[type];
}

export function isWidgetType(t: unknown): t is WidgetType {
  return typeof t === "string" && t in WIDGETS;
}

export function instanceLabel(w: WidgetInstance): string {
  const def = widgetDef(w.type);
  return def.instanceLabel ? `${def.label} — ${def.instanceLabel(w.settings)}` : def.label;
}

export function newWidgetId(): string {
  return `w_${Math.random().toString(36).slice(2, 10)}`;
}

export function createWidget(type: WidgetType): WidgetInstance {
  const def = widgetDef(type);
  return {
    id: newWidgetId(),
    type,
    size: def.defaultSize,
    settings: { ...(def.defaultSettings ?? {}) },
  };
}

/** The dashboard as it shipped before customisation — the last-resort fallback. */
export function builtInLayout(): DashboardLayout {
  const w = (type: WidgetType, settings: WidgetSettings = {}): WidgetInstance => ({
    ...createWidget(type),
    id: `default_${type}_${settings.channel ?? ""}`,
    settings: { ...(widgetDef(type).defaultSettings ?? {}), ...settings },
  });
  return {
    version: 1,
    widgets: [
      w("alerts"),
      w("snapshot"),
      w("secondary"),
      w("channel_sales", { channel: "online_sales" }),
      w("channel_sales", { channel: "delivery_sales" }),
      w("venue_stats"),
      w("revenue_trend"),
      w("reviews"),
      w("quick_links"),
    ],
  };
}

/**
 * Clean up a layout read from the database: drop widgets whose type no longer
 * exists, snap sizes to what the widget allows, and de-duplicate ids. Keeps an
 * old saved layout from breaking the page after widgets are renamed/removed.
 */
export function sanitiseLayout(raw: unknown): DashboardLayout | null {
  const widgets = (raw as { widgets?: unknown })?.widgets;
  if (!Array.isArray(widgets)) return null;
  const seen = new Set<string>();
  const clean: WidgetInstance[] = [];
  for (const item of widgets) {
    const w = item as Partial<WidgetInstance>;
    if (!isWidgetType(w.type)) continue;
    const def = widgetDef(w.type);
    let id = typeof w.id === "string" && w.id ? w.id : newWidgetId();
    if (seen.has(id)) id = newWidgetId();
    seen.add(id);
    const size = w.size && def.sizes.includes(w.size) ? w.size : def.defaultSize;
    const s = (w.settings ?? {}) as WidgetSettings;
    clean.push({
      id,
      type: w.type,
      size,
      settings: {
        ...(def.defaultSettings ?? {}),
        ...(Array.isArray(s.restaurantIds) ? { restaurantIds: s.restaurantIds.filter((x) => typeof x === "string") } : {}),
        ...(s.channel && s.channel in CHANNELS ? { channel: s.channel } : {}),
      },
    });
  }
  return { version: 1, widgets: clean };
}
