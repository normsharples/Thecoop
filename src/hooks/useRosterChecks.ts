import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAwardConfig } from "@/hooks/useAward";
import {
  DEFAULT_COMPLIANCE,
  DEFAULT_RULES,
  mergeRosterCheckConfig,
  type ComplianceOptions,
  type RosterCheckConfig,
} from "@/lib/rosterCompliance";
import type { AwardConfig } from "@/lib/award";

const SETTINGS_KEY = "roster_checks";
export const ROSTER_CHECKS_QUERY_KEY = ["app-settings", SETTINGS_KEY];

/**
 * The thresholds the award already implies. These are what the checks use
 * until someone saves their own in Settings → Roster Checks, so the award
 * config stays the single origin for the numbers it actually defines.
 */
export function awardComplianceDefaults(award: AwardConfig): ComplianceOptions {
  return {
    ...DEFAULT_COMPLIANCE,
    maxShiftHours: award.ot_daily_hours,
    weeklyHours: award.ot_weekly_hours,
    minorMorningStart: award.morning_end,
    minorNightEnd: award.evening_start,
  };
}

/**
 * Roster-check settings: which checks run, how loudly, and at what thresholds.
 * Stored globally in `app_settings` under 'roster_checks' — these are award
 * rules, so they don't vary by venue.
 */
export function useRosterCheckConfig(): {
  config: RosterCheckConfig;
  defaults: RosterCheckConfig;
  isCustomised: boolean;
  isLoading: boolean;
} {
  const award = useAwardConfig();

  const { data, isLoading } = useQuery({
    queryKey: ROSTER_CHECKS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", SETTINGS_KEY)
        .maybeSingle();
      if (error) throw error;
      return (data?.value as RosterCheckConfig | undefined) ?? null;
    },
    staleTime: 60_000,
  });

  const defaults = useMemo<RosterCheckConfig>(
    () => ({ options: awardComplianceDefaults(award), rules: DEFAULT_RULES }),
    [award]
  );

  const config = useMemo(
    () => mergeRosterCheckConfig(data ?? null, defaults),
    [data, defaults]
  );

  return { config, defaults, isCustomised: !!data, isLoading };
}

export function useSaveRosterChecks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (value: RosterCheckConfig) => {
      const { error } = await supabase
        .from("app_settings")
        .upsert({ key: SETTINGS_KEY, value }, { onConflict: "key" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ROSTER_CHECKS_QUERY_KEY });
      // The builder's issue list is derived from these — refresh it too.
      qc.invalidateQueries({ queryKey: ["shifts"] });
    },
  });
}

/** Drop the saved settings and fall back to the award-derived defaults. */
export function useResetRosterChecks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("app_settings").delete().eq("key", SETTINGS_KEY);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ROSTER_CHECKS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["shifts"] });
    },
  });
}
