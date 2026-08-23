import { useEffect, useState } from "react";
import { X, Loader2, Eye, EyeOff, FileText, Save, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useRestaurants } from "@/hooks/useRestaurants";
import {
  useEmployeeProfile,
  useSaveEmployeeProfile,
  useEmployeeSensitive,
  useSaveSensitive,
  useEmployeeDocuments,
  useDocumentActions,
  useChecklistItems,
  useEmployeeChecklist,
  useToggleChecklist,
  useOnboardingList,
} from "@/hooks/useOnboarding";
import { Field, TextInput, SelectInput, ReadOnly, AU_STATES, mask } from "./fields";
import ContractPanel from "./ContractPanel";
import { useAutoIssueContract, ISSUE_REASONS } from "@/hooks/useContracts";
import { effectiveHourlyRate, LEVEL_LABELS, type AwardLevel } from "@/lib/award";
import type { EmployeeDocument, Profile } from "@/types";

const AWARD_LEVEL_OPTIONS = (Object.keys(LEVEL_LABELS) as AwardLevel[]).map((l) => ({
  value: l,
  label: LEVEL_LABELS[l],
}));

/**
 * Shows exactly what the contract will print for pay, so the award level and
 * the rate can be set and checked without leaving this panel.
 */
function RatePreview({ form }: { form: Partial<Profile> }) {
  if (form.pay_type === "salary") {
    return (
      <p className="mt-3 rounded-md border border-border bg-muted/40 p-2.5 text-xs">
        {form.salary_annual != null
          ? <>Contract will print <span className="font-medium text-foreground">${form.salary_annual.toLocaleString()}</span> per year.</>
          : <span className="text-warning">No salary set — the contract can't be issued.</span>}
      </p>
    );
  }
  const onDate = form.start_date || new Date().toISOString().slice(0, 10);
  const eff = effectiveHourlyRate(
    { award_level: form.award_level, date_of_birth: form.date_of_birth, base_pay_rate: form.base_pay_rate },
    onDate
  );
  return (
    <p className="mt-3 rounded-md border border-border bg-muted/40 p-2.5 text-xs">
      {eff.rate == null ? (
        <span className="text-warning">
          No rate yet — pick an award level, or type a manual rate. Until then the contract can't be issued.
        </span>
      ) : (
        <>
          Contract will print{" "}
          <span className="font-medium text-foreground">${eff.rate.toFixed(2)}/hr</span>
          {eff.isOverride
            ? " (manual override)"
            : eff.juniorPct != null && eff.juniorPct < 100
              ? ` — ${eff.juniorPct}% junior rate of $${eff.adult?.toFixed(2)}`
              : " — adult award rate"}
          . Penalties and casual loading are applied on top when hours are paid.
        </>
      )}
    </p>
  );
}

type Tab = "details" | "money" | "contract" | "documents" | "checklist";

const DOC_KINDS = [
  { value: "food_handler", label: "Food handler certificate" },
  { value: "rsa", label: "RSA" },
  { value: "visa", label: "Visa / work rights" },
  { value: "id", label: "Photo ID" },
  { value: "qualification", label: "Qualification" },
  { value: "other", label: "Other" },
];

export default function EmployeeOnboardingDrawer({
  employeeId,
  onClose,
}: {
  employeeId: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("details");
  const { data: profile, isLoading } = useEmployeeProfile(employeeId);
  const { data: rows } = useOnboardingList();
  const row = rows?.find((r) => r.employee_id === employeeId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-xl flex-col bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {profile?.full_name ?? "Team member"}
            </h2>
            {row && (
              <p className="text-xs text-muted-foreground">
                {row.status === "complete"
                  ? `Completed ${row.completed_at ? format(new Date(row.completed_at), "d MMM yyyy") : ""}`
                  : `Step ${row.current_step} of 6`}
              </p>
            )}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-border px-4">
          {(["details", "money", "contract", "documents", "checklist"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "border-b-2 px-3 py-2 text-sm font-medium capitalize",
                tab === t
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "money" ? "Tax & bank" : t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {isLoading || !profile ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : tab === "details" ? (
            <DetailsTab profile={profile} />
          ) : tab === "money" ? (
            <MoneyTab employeeId={employeeId} />
          ) : tab === "contract" ? (
            <ContractPanel employeeId={employeeId} />
          ) : tab === "documents" ? (
            <DocumentsTab employeeId={employeeId} />
          ) : (
            <ChecklistTab employeeId={employeeId} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Details ─────────────────────────────────────────────────────────────────

function DetailsTab({ profile }: { profile: Profile }) {
  const save = useSaveEmployeeProfile();
  const autoIssue = useAutoIssueContract();
  const { data: restaurants } = useRestaurants();
  const [form, setForm] = useState<Partial<Profile>>(profile);
  useEffect(() => setForm(profile), [profile]);

  const set = (k: keyof Profile, v: string | number | null) =>
    setForm((f) => ({ ...f, [k]: v }));


  const onSave = async () => {
    try {
      await save.mutateAsync({
        employeeId: profile.id,
        patch: {
          legal_first_name: form.legal_first_name || null,
          legal_middle_name: form.legal_middle_name || null,
          legal_last_name: form.legal_last_name || null,
          preferred_name: form.preferred_name || null,
          date_of_birth: form.date_of_birth || null,
          phone: form.phone || null,
          contact_email: form.contact_email || null,
          address_line1: form.address_line1 || null,
          address_line2: form.address_line2 || null,
          suburb: form.suburb || null,
          address_state: form.address_state || null,
          postcode: form.postcode || null,
          emergency_name: form.emergency_name || null,
          emergency_relationship: form.emergency_relationship || null,
          emergency_phone: form.emergency_phone || null,
          emergency_phone_alt: form.emergency_phone_alt || null,
          medical_notes: form.medical_notes || null,
          work_eligibility: (form.work_eligibility as Profile["work_eligibility"]) || null,
          visa_subclass: form.visa_subclass || null,
          visa_expiry: form.visa_expiry || null,
          position_title: form.position_title || null,
          start_date: form.start_date || null,
          probation_weeks: form.probation_weeks ?? null,
          // Employment terms — superadmin only. The 063 guard rejects these
          // from anyone else, so this save fails loudly rather than silently.
          home_restaurant_id: form.home_restaurant_id || null,
          employment_type: (form.employment_type as Profile["employment_type"]) || null,
          award_level: (form.award_level as Profile["award_level"]) || null,
          pay_type: (form.pay_type as Profile["pay_type"]) || "hourly",
          base_pay_rate: form.pay_type === "salary" ? null : form.base_pay_rate ?? null,
          salary_annual: form.pay_type === "salary" ? form.salary_annual ?? null : null,
          contracted_hours: form.contracted_hours ?? null,
        },
      });
      toast.success("Details saved");

      // If the employee already finished their part, this is the moment the
      // contract becomes issuable — send it rather than waiting for a click.
      try {
        const res = await autoIssue.mutateAsync({ employeeId: profile.id });
        if (res?.issued) {
          toast.success(`Contract sent for signature${res.signatory ? `, signed as ${res.signatory}` : ""}`);
        } else if (res?.reason && res.reason !== "not_ready" && res.reason !== "no_onboarding_record") {
          toast.message(ISSUE_REASONS[res.reason] ?? "Contract not sent yet.");
        }
      } catch {
        /* Saving succeeded; issuing is best-effort. */
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <Section title="Personal">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Legal first name" required>
            <TextInput value={form.legal_first_name ?? ""} onChange={(v) => set("legal_first_name", v)} />
          </Field>
          <Field label="Legal last name" required>
            <TextInput value={form.legal_last_name ?? ""} onChange={(v) => set("legal_last_name", v)} />
          </Field>
          <Field label="Middle name">
            <TextInput value={form.legal_middle_name ?? ""} onChange={(v) => set("legal_middle_name", v)} />
          </Field>
          <Field label="Goes by">
            <TextInput value={form.preferred_name ?? ""} onChange={(v) => set("preferred_name", v)} />
          </Field>
          <Field label="Date of birth" required>
            <TextInput type="date" value={form.date_of_birth ?? ""} onChange={(v) => set("date_of_birth", v)} />
          </Field>
          <Field label="Mobile" required>
            <TextInput value={form.phone ?? ""} onChange={(v) => set("phone", v)} />
          </Field>
          <Field label="Personal email" className="col-span-2">
            <TextInput type="email" value={form.contact_email ?? ""} onChange={(v) => set("contact_email", v)} />
          </Field>
        </div>
      </Section>

      <Section title="Address">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Street address" required className="col-span-2">
            <TextInput value={form.address_line1 ?? ""} onChange={(v) => set("address_line1", v)} />
          </Field>
          <Field label="Unit / building" className="col-span-2">
            <TextInput value={form.address_line2 ?? ""} onChange={(v) => set("address_line2", v)} />
          </Field>
          <Field label="Suburb" required>
            <TextInput value={form.suburb ?? ""} onChange={(v) => set("suburb", v)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="State" required>
              <SelectInput value={form.address_state ?? ""} onChange={(v) => set("address_state", v)} options={AU_STATES} placeholder="—" />
            </Field>
            <Field label="Postcode" required>
              <TextInput inputMode="numeric" value={form.postcode ?? ""} onChange={(v) => set("postcode", v)} />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Emergency contact">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" required>
            <TextInput value={form.emergency_name ?? ""} onChange={(v) => set("emergency_name", v)} />
          </Field>
          <Field label="Relationship">
            <TextInput value={form.emergency_relationship ?? ""} onChange={(v) => set("emergency_relationship", v)} />
          </Field>
          <Field label="Phone" required>
            <TextInput value={form.emergency_phone ?? ""} onChange={(v) => set("emergency_phone", v)} />
          </Field>
          <Field label="Alternate phone">
            <TextInput value={form.emergency_phone_alt ?? ""} onChange={(v) => set("emergency_phone_alt", v)} />
          </Field>
          <Field label="Medical notes / allergies" className="col-span-2" hint="Only what we'd need in an emergency.">
            <TextInput value={form.medical_notes ?? ""} onChange={(v) => set("medical_notes", v)} />
          </Field>
        </div>
      </Section>

      <Section title="Work eligibility">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status" required className="col-span-2">
            <SelectInput
              value={form.work_eligibility ?? ""}
              onChange={(v) => set("work_eligibility", v)}
              placeholder="Select…"
              options={[
                { value: "citizen", label: "Australian citizen" },
                { value: "permanent_resident", label: "Permanent resident" },
                { value: "visa", label: "Visa holder" },
              ]}
            />
          </Field>
          {form.work_eligibility === "visa" && (
            <>
              <Field label="Visa subclass" required>
                <TextInput value={form.visa_subclass ?? ""} onChange={(v) => set("visa_subclass", v)} />
              </Field>
              <Field label="Visa expiry" required>
                <TextInput type="date" value={form.visa_expiry ?? ""} onChange={(v) => set("visa_expiry", v)} />
              </Field>
            </>
          )}
        </div>
      </Section>

      <Section title="Employment terms">
        <p className="mb-3 text-xs text-muted-foreground">
          These drive the contract. Award level (or a manual rate) is what produces the pay rate and
          classification the contract prints — leave them empty and the contract can't be issued.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Position title">
            <TextInput value={form.position_title ?? ""} onChange={(v) => set("position_title", v)} />
          </Field>
          <Field label="Home store">
            <SelectInput
              value={form.home_restaurant_id ?? ""}
              onChange={(v) => set("home_restaurant_id", v || null)}
              placeholder="Select…"
              options={(restaurants ?? []).map((r) => ({ value: r.id, label: r.name }))}
            />
          </Field>
          <Field label="Employment type">
            <SelectInput
              value={form.employment_type ?? ""}
              onChange={(v) => set("employment_type", v || null)}
              placeholder="Select…"
              options={[
                { value: "casual", label: "Casual" },
                { value: "part_time", label: "Part-time" },
                { value: "full_time", label: "Full-time" },
              ]}
            />
          </Field>
          <Field label="Award level" hint="MA000003 classification.">
            <SelectInput
              value={form.award_level ?? ""}
              onChange={(v) => set("award_level", v || null)}
              placeholder="Select…"
              options={AWARD_LEVEL_OPTIONS}
            />
          </Field>
          <Field label="Start date">
            <TextInput type="date" value={form.start_date ?? ""} onChange={(v) => set("start_date", v)} />
          </Field>
          <Field label="Probation (weeks)">
            <TextInput
              inputMode="numeric"
              value={form.probation_weeks?.toString() ?? ""}
              onChange={(v) => set("probation_weeks", v === "" ? null : Number(v))}
            />
          </Field>
          <Field label="Paid as">
            <SelectInput
              value={form.pay_type ?? "hourly"}
              onChange={(v) => set("pay_type", v)}
              options={[
                { value: "hourly", label: "Hourly" },
                { value: "salary", label: "Salary" },
              ]}
            />
          </Field>
          <Field label="Contracted hours / week" hint="Part-time guarantee; blank for casual.">
            <TextInput
              inputMode="decimal"
              value={form.contracted_hours?.toString() ?? ""}
              onChange={(v) => set("contracted_hours", v === "" ? null : Number(v))}
            />
          </Field>
          {form.pay_type === "salary" ? (
            <Field label="Annual salary" className="col-span-2">
              <TextInput
                inputMode="decimal"
                value={form.salary_annual?.toString() ?? ""}
                onChange={(v) => set("salary_annual", v === "" ? null : Number(v))}
              />
            </Field>
          ) : (
            <Field
              label="Manual rate override"
              className="col-span-2"
              hint="Leave blank to use the award rate derived from level + age."
            >
              <TextInput
                inputMode="decimal"
                placeholder="Auto from award"
                value={form.base_pay_rate?.toString() ?? ""}
                onChange={(v) => set("base_pay_rate", v === "" ? null : Number(v))}
              />
            </Field>
          )}
        </div>

        <RatePreview form={form} />
      </Section>

      <button
        onClick={onSave}
        disabled={save.isPending}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save details
      </button>
    </div>
  );
}

// ── Tax / super / bank ──────────────────────────────────────────────────────

function MoneyTab({ employeeId }: { employeeId: string }) {
  const { data, isLoading } = useEmployeeSensitive(employeeId);
  const save = useSaveSensitive();
  const [reveal, setReveal] = useState(false);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<Record<string, string | boolean | null>>({});

  useEffect(() => {
    if (data) setForm({ ...data } as Record<string, string | boolean | null>);
  }, [data]);

  if (isLoading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const str = (k: string) => (form[k] as string) ?? "";

  const onSave = async () => {
    try {
      await save.mutateAsync({
        employeeId,
        patch: {
          tfn: str("tfn") || null,
          tfn_exemption: (str("tfn_exemption") || null) as never,
          tax_free_threshold: !!form.tax_free_threshold,
          help_debt: !!form.help_debt,
          tax_residency: (str("tax_residency") || null) as never,
          super_choice: (str("super_choice") || null) as never,
          super_fund_name: str("super_fund_name") || null,
          super_usi: str("super_usi") || null,
          super_member_number: str("super_member_number") || null,
          bank_account_name: str("bank_account_name") || null,
          bank_bsb: str("bank_bsb") || null,
          bank_account_number: str("bank_account_number") || null,
        },
      });
      toast.success("Saved");
      setEdit(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (!edit) {
    return (
      <div className="space-y-5">
        <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-muted-foreground">
          Visible to superadmins only. Managers and area managers cannot read this tab.
        </div>
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-foreground">Tax</h4>
          <button
            onClick={() => setReveal((r) => !r)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {reveal ? "Hide" : "Reveal"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ReadOnly label="Tax file number" value={reveal ? data?.tfn || "—" : mask(data?.tfn)} />
          <ReadOnly label="TFN exemption" value={data?.tfn_exemption} />
          <ReadOnly label="Tax-free threshold" value={data?.tax_free_threshold ? "Claimed" : "Not claimed"} />
          <ReadOnly label="HELP/HECS debt" value={data?.help_debt ? "Yes" : "No"} />
          <ReadOnly label="Residency" value={data?.tax_residency} />
        </div>
        <h4 className="text-sm font-semibold text-foreground">Super</h4>
        <div className="grid grid-cols-2 gap-3">
          <ReadOnly label="Choice" value={data?.super_choice === "employer_default" ? "Employer default fund" : data?.super_choice ? "Own fund" : "—"} />
          <ReadOnly label="Fund" value={data?.super_fund_name} />
          <ReadOnly label="USI" value={data?.super_usi} />
          <ReadOnly label="Member number" value={reveal ? data?.super_member_number || "—" : mask(data?.super_member_number)} />
        </div>
        <h4 className="text-sm font-semibold text-foreground">Bank</h4>
        <div className="grid grid-cols-2 gap-3">
          <ReadOnly label="Account name" value={data?.bank_account_name} />
          <ReadOnly label="BSB" value={reveal ? data?.bank_bsb || "—" : mask(data?.bank_bsb)} />
          <ReadOnly label="Account number" value={reveal ? data?.bank_account_number || "—" : mask(data?.bank_account_number)} />
        </div>
        <button onClick={() => setEdit(true)} className="rounded-md border border-border px-3 py-1.5 text-sm">
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tax file number">
          <TextInput inputMode="numeric" value={str("tfn")} onChange={(v) => set("tfn", v)} />
        </Field>
        <Field label="Or exemption">
          <SelectInput
            value={str("tfn_exemption")}
            onChange={(v) => set("tfn_exemption", v)}
            placeholder="—"
            options={[
              { value: "applied", label: "Applied for a TFN" },
              { value: "under_18", label: "Under 18, under threshold" },
              { value: "pensioner", label: "Pensioner" },
              { value: "not_provided", label: "Chose not to provide" },
            ]}
          />
        </Field>
        <Field label="Residency for tax">
          <SelectInput
            value={str("tax_residency")}
            onChange={(v) => set("tax_residency", v)}
            placeholder="—"
            options={[
              { value: "resident", label: "Australian resident" },
              { value: "foreign", label: "Foreign resident" },
              { value: "working_holiday", label: "Working holiday maker" },
            ]}
          />
        </Field>
        <div className="flex flex-col justify-end gap-2 pb-1">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.tax_free_threshold} onChange={(e) => set("tax_free_threshold", e.target.checked)} className="h-4 w-4" />
            Claims tax-free threshold
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.help_debt} onChange={(e) => set("help_debt", e.target.checked)} className="h-4 w-4" />
            Has HELP/HECS debt
          </label>
        </div>
        <Field label="Super" className="col-span-2">
          <SelectInput
            value={str("super_choice")}
            onChange={(v) => set("super_choice", v)}
            placeholder="—"
            options={[
              { value: "employer_default", label: "Use the employer default fund" },
              { value: "own_fund", label: "Own fund" },
            ]}
          />
        </Field>
        {str("super_choice") === "own_fund" && (
          <>
            <Field label="Fund name"><TextInput value={str("super_fund_name")} onChange={(v) => set("super_fund_name", v)} /></Field>
            <Field label="USI"><TextInput value={str("super_usi")} onChange={(v) => set("super_usi", v)} /></Field>
            <Field label="Member number" className="col-span-2">
              <TextInput value={str("super_member_number")} onChange={(v) => set("super_member_number", v)} />
            </Field>
          </>
        )}
        <Field label="Account name" className="col-span-2">
          <TextInput value={str("bank_account_name")} onChange={(v) => set("bank_account_name", v)} />
        </Field>
        <Field label="BSB"><TextInput inputMode="numeric" value={str("bank_bsb")} onChange={(v) => set("bank_bsb", v)} /></Field>
        <Field label="Account number"><TextInput inputMode="numeric" value={str("bank_account_number")} onChange={(v) => set("bank_account_number", v)} /></Field>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onSave}
          disabled={save.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </button>
        <button onClick={() => setEdit(false)} className="rounded-md border border-border px-3 py-2 text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Documents ───────────────────────────────────────────────────────────────

function DocumentsTab({ employeeId }: { employeeId: string }) {
  const { data: docs, isLoading } = useEmployeeDocuments(employeeId);
  const { upload, remove, signedUrl } = useDocumentActions();
  const [kind, setKind] = useState("food_handler");
  const [label, setLabel] = useState("");
  const [expires, setExpires] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const add = async () => {
    try {
      await upload.mutateAsync({
        employeeId,
        file,
        kind: kind as EmployeeDocument["kind"],
        label,
        expiresOn: expires || null,
      });
      toast.success("Document added");
      setLabel(""); setExpires(""); setFile(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const open = async (doc: EmployeeDocument) => {
    if (!doc.file_path) return;
    try {
      window.open(await signedUrl(doc.file_path), "_blank");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border p-4">
        <h4 className="mb-3 text-sm font-semibold text-foreground">Add a document</h4>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <SelectInput value={kind} onChange={setKind} options={DOC_KINDS} />
          </Field>
          <Field label="Expires">
            <TextInput type="date" value={expires} onChange={setExpires} />
          </Field>
          <Field label="Label" className="col-span-2">
            <TextInput value={label} onChange={setLabel} placeholder="e.g. Food Handler Level 1" />
          </Field>
          <Field label="File" className="col-span-2" hint="Image or PDF, up to 10 MB.">
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm"
            />
          </Field>
        </div>
        <button
          onClick={add}
          disabled={upload.isPending}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          Add
        </button>
      </div>

      {isLoading ? (
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
      ) : !docs?.length ? (
        <p className="text-sm text-muted-foreground">No documents yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {docs.map((d) => {
            const expired = d.expires_on && new Date(d.expires_on) < new Date();
            return (
              <li key={d.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {d.label || DOC_KINDS.find((k) => k.value === d.kind)?.label || d.kind}
                  </p>
                  <p className={cn("text-xs", expired ? "text-destructive" : "text-muted-foreground")}>
                    {d.expires_on
                      ? `${expired ? "Expired" : "Expires"} ${format(new Date(d.expires_on), "d MMM yyyy")}`
                      : "No expiry"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {d.file_path && (
                    <button onClick={() => open(d)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                      <FileText className="h-4 w-4" />
                    </button>
                  )}
                  <button onClick={() => remove.mutate(d)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Checklist ───────────────────────────────────────────────────────────────

function ChecklistTab({ employeeId }: { employeeId: string }) {
  const { data: items } = useChecklistItems();
  const { data: progress } = useEmployeeChecklist(employeeId);
  const toggle = useToggleChecklist();

  const doneFor = (itemId: string) => !!progress?.find((p) => p.item_id === itemId)?.done;

  return (
    <ul className="space-y-2">
      {items?.map((item) => (
        <li key={item.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
          <input
            type="checkbox"
            checked={doneFor(item.id)}
            onChange={(e) =>
              toggle.mutate({ employeeId, itemId: item.id, done: e.target.checked })
            }
            className="mt-0.5 h-4 w-4"
          />
          <div>
            <p className="text-sm font-medium text-foreground">{item.label}</p>
            {item.description && (
              <p className="text-xs text-muted-foreground">{item.description}</p>
            )}
          </div>
        </li>
      ))}
      {!items?.length && (
        <p className="text-sm text-muted-foreground">
          No checklist items configured yet.
        </p>
      )}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-3 text-sm font-semibold text-foreground">{title}</h4>
      {children}
    </div>
  );
}
