import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { getInitials } from "@/lib/utils";
import type { Profile } from "@/types";
import PublicHolidaysSettings from "@/components/settings/PublicHolidaysSettings";
import { useAwardConfig } from "@/hooks/useAward";
import { effectiveHourlyRate, LEVEL_LABELS, type AwardConfig, type AwardLevel } from "@/lib/award";

interface PayrollGlobal {
  super_rate: number;
  casual_loading: number;
  pay_period: "weekly" | "fortnightly" | "monthly";
  clock_tolerance_min: number; // auto-approve window vs the rostered shift
}

const DEFAULT_GLOBAL: PayrollGlobal = {
  super_rate: 11.5,
  casual_loading: 25,
  pay_period: "weekly",
  clock_tolerance_min: 15,
};

const inputCls =
  "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

export default function PayrollSettings() {
  const queryClient = useQueryClient();
  const award = useAwardConfig();

  // ── Global payroll settings (app_settings key 'payroll') ────────────────────
  const { data: globalRow } = useQuery({
    queryKey: ["app-settings", "payroll"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "payroll")
        .maybeSingle();
      if (error) throw error;
      return (data?.value as PayrollGlobal | undefined) ?? null;
    },
  });
  const [global, setGlobal] = useState<PayrollGlobal | null>(null);
  const g = global ?? globalRow ?? DEFAULT_GLOBAL;

  const saveGlobal = useMutation({
    mutationFn: async (value: PayrollGlobal) => {
      const { error } = await supabase
        .from("app_settings")
        .upsert({ key: "payroll", value }, { onConflict: "key" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payroll settings saved");
      queryClient.invalidateQueries({ queryKey: ["app-settings", "payroll"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Team members ────────────────────────────────────────────────────────────
  const { data: members = [], isLoading } = useQuery({
    queryKey: ["payroll-members"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("is_rosterable", true)
        .order("full_name");
      if (error) throw error;
      return data as Profile[];
    },
  });

  const updateMember = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Profile> }) => {
      const { error } = await supabase.from("profiles").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["payroll-members"] });
      // Award level and pay rate feed the contract tokens — keep every other
      // view of this profile in step.
      queryClient.invalidateQueries({ queryKey: ["employee-profile", vars.id] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-8">
      {/* Global settings */}
      <div>
        <h2 className="text-xl font-semibold text-foreground">Payroll settings</h2>
        <p className="text-sm text-muted-foreground">
          Company-wide defaults. Award-accurate pay isn't calculated yet — these are
          stored for the payroll phase.
        </p>
        <div className="mt-4 grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Super guarantee %</label>
            <input
              type="number"
              step={0.1}
              value={g.super_rate}
              onChange={(e) => setGlobal({ ...g, super_rate: Number(e.target.value) })}
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Casual loading %</label>
            <input
              type="number"
              step={0.5}
              value={g.casual_loading}
              onChange={(e) => setGlobal({ ...g, casual_loading: Number(e.target.value) })}
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Pay period</label>
            <select
              value={g.pay_period}
              onChange={(e) =>
                setGlobal({ ...g, pay_period: e.target.value as PayrollGlobal["pay_period"] })
              }
              className={inputCls}
            >
              <option value="weekly">Weekly</option>
              <option value="fortnightly">Fortnightly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Clock tolerance (min)</label>
            <input
              type="number"
              step={1}
              value={g.clock_tolerance_min}
              onChange={(e) => setGlobal({ ...g, clock_tolerance_min: Number(e.target.value) })}
              className={inputCls}
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => saveGlobal.mutate(g)}
              disabled={saveGlobal.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saveGlobal.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </button>
          </div>
        </div>
      </div>

      {/* Per-member pay */}
      <div>
        <h3 className="text-lg font-semibold text-foreground">Team member pay</h3>
        <p className="text-sm text-muted-foreground">
          Changes save automatically. The hourly rate is derived from the award level × junior %
          (from date of birth) — leave Rate blank to use it, or type a value to override.
        </p>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : members.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border bg-card py-12 text-center text-sm text-muted-foreground">
            No rosterable team members yet — add them under Members.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Team member</th>
                  <th className="px-4 py-2 font-medium">Employment</th>
                  <th className="px-4 py-2 font-medium">Pay type</th>
                  <th className="px-4 py-2 font-medium">Date of birth</th>
                  <th className="px-4 py-2 font-medium">Award level</th>
                  <th className="px-4 py-2 font-medium">Rate ($/hr)</th>
                  <th className="px-4 py-2 font-medium">Salary ($/yr)</th>
                  <th className="px-4 py-2 font-medium">Contracted h/wk</th>
                  <th className="px-4 py-2 font-medium">Kiosk PIN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.map((m) => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    cfg={award}
                    onSave={(patch) => updateMember.mutate({ id: m.id, patch })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Public holidays */}
      <PublicHolidaysSettings />
    </div>
  );
}

function MemberRow({
  member,
  cfg,
  onSave,
}: {
  member: Profile;
  cfg: AwardConfig;
  onSave: (patch: Partial<Profile>) => void;
}) {
  const [rate, setRate] = useState(member.base_pay_rate ?? "");
  const [salary, setSalary] = useState(member.salary_annual ?? "");
  const [hours, setHours] = useState(member.contracted_hours ?? "");
  const [dob, setDob] = useState(member.date_of_birth ?? "");
  const [pin, setPin] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const payType = member.pay_type ?? "hourly";

  const today = new Date().toISOString().slice(0, 10);
  // Live preview using the currently-typed DOB (falls back to saved value).
  const eff = effectiveHourlyRate(
    { award_level: member.award_level, date_of_birth: dob || null, base_pay_rate: member.base_pay_rate },
    today,
    cfg
  );

  const numOrNull = (v: string | number) =>
    v === "" || v === null ? null : Number(v);

  const savePin = async () => {
    if (!/^[0-9]{4,6}$/.test(pin)) {
      toast.error("PIN must be 4–6 digits");
      return;
    }
    setPinBusy(true);
    try {
      const { error } = await supabase.rpc("set_pin", { target: member.id, pin });
      if (error) throw error;
      toast.success(`PIN set for ${member.full_name.split(" ")[0]}`);
      setPin("");
    } catch (e) {
      toast.error((e as { message?: string })?.message || "Couldn't set PIN");
    } finally {
      setPinBusy(false);
    }
  };

  return (
    <tr className="hover:bg-muted/10">
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
            {getInitials(member.full_name)}
          </span>
          <span className="text-sm font-medium text-foreground">{member.full_name}</span>
        </div>
      </td>
      <td className="px-4 py-2">
        <select
          value={member.employment_type ?? ""}
          onChange={(e) =>
            onSave({ employment_type: (e.target.value || null) as Profile["employment_type"] })
          }
          className={inputCls + " min-w-[120px]"}
        >
          <option value="">—</option>
          <option value="casual">Casual</option>
          <option value="part_time">Part-time</option>
          <option value="full_time">Full-time</option>
        </select>
      </td>
      <td className="px-4 py-2">
        <select
          value={payType}
          onChange={(e) => onSave({ pay_type: e.target.value as Profile["pay_type"] })}
          className={inputCls + " min-w-[100px]"}
        >
          <option value="hourly">Hourly</option>
          <option value="salary">Salary</option>
        </select>
      </td>
      <td className="px-4 py-2">
        <input
          type="date"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
          onBlur={() => onSave({ date_of_birth: dob || null })}
          className={inputCls + " w-40"}
        />
      </td>
      <td className="px-4 py-2">
        <select
          value={member.award_level ?? ""}
          disabled={payType === "salary"}
          onChange={(e) => onSave({ award_level: (e.target.value || null) as Profile["award_level"] })}
          className={inputCls + " min-w-[130px] disabled:opacity-40"}
        >
          <option value="">—</option>
          {(["1", "2", "3", "3+"] as AwardLevel[]).map((l) => (
            <option key={l} value={l}>
              {LEVEL_LABELS[l]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-2">
        {payType === "salary" ? (
          <span className="text-sm text-muted-foreground">—</span>
        ) : (
          <div className="space-y-0.5">
            <input
              type="number"
              step={0.5}
              value={rate}
              placeholder={eff.rate != null ? eff.rate.toFixed(2) : "set level"}
              onChange={(e) => setRate(e.target.value)}
              onBlur={() => onSave({ base_pay_rate: numOrNull(rate) })}
              className={inputCls + " w-24"}
            />
            <div className="text-[11px] text-muted-foreground">
              {member.base_pay_rate != null
                ? "manual override"
                : eff.rate != null
                ? `award: $${eff.rate.toFixed(2)}${
                    eff.juniorPct != null && eff.juniorPct < 100 ? ` · ${eff.juniorPct}% junior` : ""
                  }`
                : "set level + DOB"}
            </div>
          </div>
        )}
      </td>
      <td className="px-4 py-2">
        <input
          type="number"
          step={1000}
          value={salary}
          disabled={payType === "hourly"}
          onChange={(e) => setSalary(e.target.value)}
          onBlur={() => onSave({ salary_annual: numOrNull(salary) })}
          className={inputCls + " w-28 disabled:opacity-40"}
        />
      </td>
      <td className="px-4 py-2">
        <input
          type="number"
          step={1}
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          onBlur={() => onSave({ contracted_hours: numOrNull(hours) })}
          className={inputCls + " w-24"}
        />
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-1.5">
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            placeholder="4–6 digits"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            className={inputCls + " w-20"}
          />
          <button
            onClick={savePin}
            disabled={pinBusy || pin.length < 4}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-40"
          >
            Set
          </button>
        </div>
      </td>
    </tr>
  );
}
