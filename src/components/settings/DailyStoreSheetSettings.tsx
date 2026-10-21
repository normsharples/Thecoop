import { useState, useEffect } from "react";
import {
  ClipboardList,
  Loader2,
  Mail,
  Clock,
  Eye,
  EyeOff,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useActiveBrand } from "@/hooks/useActiveBrand";
import { useBrands } from "@/hooks/useBrands";
import { useDailyStoreSheetSettings } from "@/hooks/useDailyStoreSheetSettings";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Profile } from "@/types";

// 30-minute time slots for send time picker
const TIME_SLOTS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
}).filter((t) => {
  // Reasonable hours: 6 PM to 2 AM
  const h = parseInt(t.split(":")[0]);
  return h >= 18 || h <= 2;
});

const CONTENT_SECTIONS = [
  { key: "include_sales", label: "Today's Sales", description: "Total sales, net sales, and transaction count" },
  { key: "include_delivery", label: "Delivery Sales", description: "Delivery revenue and percentage of total" },
  { key: "include_yoy", label: "Year-on-Year", description: "Same-day comparison to last year" },
  { key: "include_projections", label: "Projection Variance", description: "Actual vs projected sales" },
  { key: "include_cashup", label: "Cash Up Summary", description: "Till count, expected deposit, and variance" },
  { key: "include_notes", label: "Shift Notes", description: "Notes from the daily store sheet" },
  { key: "include_reviews", label: "Google Reviews", description: "Recent reviews within the lookback period" },
] as const;

type ContentKey = (typeof CONTENT_SECTIONS)[number]["key"];

export default function DailyStoreSheetSettings() {
  const { brand } = useActiveBrand();
  const { data: brands = [] } = useBrands();

  // Use the first brand if no active brand selected
  const activeBrandId = brand?.id ?? brands[0]?.id ?? null;

  const { settings, isLoading, upsert, isUpserting } =
    useDailyStoreSheetSettings(activeBrandId);

  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, role")
        .order("full_name");
      if (error) throw error;
      return data as Profile[];
    },
  });

  // Only show managers and above as potential recipients
  const eligibleProfiles = profiles.filter(
    (p) =>
      p.role === "superadmin" ||
      p.role === "area_manager" ||
      p.role === "manager"
  );

  const [localEnabled, setLocalEnabled] = useState(true);
  const [localSendTime, setLocalSendTime] = useState("22:00");
  const [localRecipients, setLocalRecipients] = useState<string[]>([]);
  const [localToggles, setLocalToggles] = useState<Record<ContentKey, boolean>>({
    include_sales: true,
    include_delivery: true,
    include_yoy: true,
    include_projections: true,
    include_cashup: true,
    include_notes: true,
    include_reviews: true,
  });
  const [localLookback, setLocalLookback] = useState(7);

  // Sync local state when settings load
  useEffect(() => {
    if (settings) {
      setLocalEnabled(settings.enabled);
      setLocalSendTime(settings.send_time);
      setLocalRecipients(settings.recipients);
      setLocalToggles({
        include_sales: settings.include_sales,
        include_delivery: settings.include_delivery,
        include_yoy: settings.include_yoy,
        include_projections: settings.include_projections,
        include_cashup: settings.include_cashup,
        include_notes: settings.include_notes,
        include_reviews: settings.include_reviews,
      });
      setLocalLookback(settings.review_lookback_days);
    }
  }, [settings]);

  async function save(patch: Record<string, unknown>) {
    if (!activeBrandId) return;
    try {
      await upsert({ brand_id: activeBrandId, ...patch });
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    }
  }

  async function toggleEnabled() {
    const next = !localEnabled;
    setLocalEnabled(next);
    await save({ enabled: next });
  }

  async function handleSendTimeChange(time: string) {
    setLocalSendTime(time);
    await save({ send_time: time });
  }

  async function toggleRecipient(profileId: string) {
    const next = localRecipients.includes(profileId)
      ? localRecipients.filter((id) => id !== profileId)
      : [...localRecipients, profileId];
    setLocalRecipients(next);
    await save({ recipients: next });
  }

  async function toggleContentSection(key: ContentKey) {
    const next = { ...localToggles, [key]: !localToggles[key] };
    setLocalToggles(next);
    await save({ [key]: next[key] });
  }

  async function handleLookbackChange(days: number) {
    setLocalLookback(days);
    await save({ review_lookback_days: days });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!activeBrandId) {
    return (
      <div className="rounded-xl border border-border bg-card px-5 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          No brand found. Create a brand first to configure the daily store
          sheet email.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3 mb-1">
          <ClipboardList className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-card-foreground">
            Daily Store Sheet
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Configure the nightly summary email sent to managers at the end of
          each trading day. The email includes sales, cash-up, shift notes, and
          reviews for every venue.
        </p>
      </div>

      {/* Enable/disable */}
      <div className="rounded-xl border border-border bg-card px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Mail className="h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-semibold text-card-foreground">
                Nightly Email
              </p>
              <p className="text-xs text-muted-foreground">
                Send a summary email each night
              </p>
            </div>
          </div>
          <button
            disabled={isUpserting}
            onClick={toggleEnabled}
            className={cn(
              "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
              localEnabled ? "bg-primary" : "bg-muted",
              isUpserting && "cursor-not-allowed opacity-60"
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform",
                localEnabled ? "translate-x-4" : "translate-x-0"
              )}
            />
          </button>
        </div>
      </div>

      {localEnabled && (
        <>
          {/* Send time */}
          <div className="rounded-xl border border-border bg-card px-5 py-4">
            <div className="flex items-center gap-3 mb-3">
              <Clock className="h-4 w-4 text-primary" />
              <div>
                <p className="text-sm font-semibold text-card-foreground">
                  Send Time
                </p>
                <p className="text-xs text-muted-foreground">
                  When the email is sent each night (AEST)
                </p>
              </div>
            </div>
            <select
              value={localSendTime}
              onChange={(e) => handleSendTimeChange(e.target.value)}
              disabled={isUpserting}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {TIME_SLOTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Recipients */}
          <div className="rounded-xl border border-border bg-card px-5 py-4">
            <label className="text-sm font-semibold text-card-foreground block mb-1">
              Email Recipients
            </label>
            <p className="text-xs text-muted-foreground mb-3">
              Managers, area managers, and admins who receive the nightly email.
            </p>
            {eligibleProfiles.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No eligible recipients found.
              </p>
            ) : (
              <div className="space-y-1.5">
                {eligibleProfiles.map((p) => (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={localRecipients.includes(p.id)}
                      onChange={() => toggleRecipient(p.id)}
                      disabled={isUpserting}
                      className="h-3.5 w-3.5 rounded border border-input accent-primary"
                    />
                    <span className="text-xs text-foreground">
                      {p.full_name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {p.email}
                    </span>
                    <span className="text-xs text-muted-foreground capitalize ml-auto">
                      {p.role.replace("_", " ")}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Content sections */}
          <div className="rounded-xl border border-border bg-card px-5 py-4">
            <label className="text-sm font-semibold text-card-foreground block mb-1">
              Email Content
            </label>
            <p className="text-xs text-muted-foreground mb-3">
              Choose which sections to include in the nightly email.
            </p>
            <div className="space-y-2">
              {CONTENT_SECTIONS.map((section) => (
                <div
                  key={section.key}
                  className="flex items-center justify-between py-1.5"
                >
                  <div className="flex items-center gap-2.5">
                    {localToggles[section.key] ? (
                      <Eye className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <div>
                      <p className="text-sm text-foreground">{section.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {section.description}
                      </p>
                    </div>
                  </div>
                  <button
                    disabled={isUpserting}
                    onClick={() => toggleContentSection(section.key)}
                    className={cn(
                      "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                      localToggles[section.key] ? "bg-primary" : "bg-muted",
                      isUpserting && "cursor-not-allowed opacity-60"
                    )}
                  >
                    <span
                      className={cn(
                        "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition-transform",
                        localToggles[section.key]
                          ? "translate-x-4"
                          : "translate-x-0"
                      )}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Review lookback */}
          {localToggles.include_reviews && (
            <div className="rounded-xl border border-border bg-card px-5 py-4">
              <label className="text-sm font-semibold text-card-foreground block mb-1">
                Review Lookback Period
              </label>
              <p className="text-xs text-muted-foreground mb-3">
                How many days of recent Google reviews to include in the email.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={localLookback}
                  min={1}
                  max={30}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    if (!isNaN(v) && v >= 1 && v <= 30) {
                      handleLookbackChange(v);
                    }
                  }}
                  disabled={isUpserting}
                  className="w-20 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring tabular-nums"
                />
                <span className="text-sm text-muted-foreground">days</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
