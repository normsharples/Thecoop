import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { DEFAULT_AWARD, type AwardConfig } from "@/lib/award";

export interface PublicHoliday {
  id: string;
  date: string;
  state: string;
  name: string;
}

/** Public holidays within a date range (all states); caller filters by store state. */
export function usePublicHolidays(from: string, to: string) {
  return useQuery({
    queryKey: ["public-holidays", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("public_holidays")
        .select("*")
        .gte("date", from)
        .lte("date", to)
        .order("date");
      if (error) throw error;
      return (data ?? []) as PublicHoliday[];
    },
  });
}

export interface PayrollConfig {
  super_rate: number;
  casual_loading: number;
  pay_period: "weekly" | "fortnightly" | "monthly";
  clock_tolerance_min: number;
}

const DEFAULT_PAYROLL: PayrollConfig = {
  super_rate: 11.5,
  casual_loading: 25,
  pay_period: "weekly",
  clock_tolerance_min: 15,
};

/** Company payroll settings from app_settings 'payroll' (super rate etc.). */
export function usePayrollConfig(): PayrollConfig {
  const { data } = useQuery({
    queryKey: ["app-settings", "payroll"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "payroll")
        .maybeSingle();
      if (error) throw error;
      return (data?.value as Partial<PayrollConfig> | undefined) ?? null;
    },
  });
  return { ...DEFAULT_PAYROLL, ...(data ?? {}) };
}

/** Award config from app_settings 'award', merged over the built-in defaults. */
export function useAwardConfig(): AwardConfig {
  const { data } = useQuery({
    queryKey: ["app-settings", "award"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "award")
        .maybeSingle();
      if (error) throw error;
      return (data?.value as Partial<AwardConfig> | undefined) ?? null;
    },
  });
  return { ...DEFAULT_AWARD, ...(data ?? {}) };
}
