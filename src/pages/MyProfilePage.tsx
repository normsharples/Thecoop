import { useEffect, useMemo, useState } from "react";
import {
  User, Loader2, Save, ShieldCheck, Lock, FileText, Download, Clock3, Paperclip, Trash2, PenLine,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useRestaurants } from "@/hooks/useRestaurants";
import {
  useEmployeeSensitive, useCompanySettings, useEmployeeDocuments, useDocumentActions,
} from "@/hooks/useOnboarding";
import { useEmployeeContracts, renderSignedDocument } from "@/hooks/useContracts";
import { printContract } from "@/lib/contract";
import { Field, TextInput, SelectInput, ReadOnly, AU_STATES, mask } from "@/components/onboarding/fields";
import type { Profile, ProfileChangeRequest, EmployeeDocument } from "@/types";

type Tab = "details" | "money" | "documents" | "contracts";

const EMPLOYMENT_LABELS: Record<string, string> = {
  casual: "Casual", part_time: "Part-time", full_time: "Full-time",
};

export default function MyProfilePage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>("details");

  if (!profile) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <User className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">My profile</h1>
          <p className="text-sm text-muted-foreground">{profile.full_name}</p>
        </div>
      </div>

      <div className="inline-flex flex-wrap rounded-lg border border-border p-0.5">
        {(["details", "money", "documents", "contracts"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium capitalize",
              tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "money" ? "Pay details" : t}
          </button>
        ))}
      </div>

      {tab === "details" && <DetailsTab profile={profile} />}
      {tab === "money" && <MoneyTab profile={profile} />}
      {tab === "documents" && <DocumentsTab profile={profile} />}
      {tab === "contracts" && <ContractsTab profile={profile} />}
    </div>
  );
}

// ── Pending-request helper ──────────────────────────────────────────────────

function usePendingRequests(employeeId: string) {
  const [rows, setRows] = useState<ProfileChangeRequest[]>([]);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    supabase
      .from("profile_change_requests")
      .select("*")
      .eq("employee_id", employeeId)
      .eq("status", "pending")
      .then(({ data }) => setRows((data ?? []) as ProfileChangeRequest[]));
  }, [employeeId, refresh]);
  return { rows, reload: () => setRefresh((r) => r + 1) };
}

async function submitChange(
  employeeId: string,
  scope: "profile" | "sensitive",
  payload: Record<string, string | null>
) {
  const { error } = await supabase
    .from("profile_change_requests")
    .insert({ employee_id: employeeId, scope, payload });
  if (error) throw error;
}

// ── Details (free to edit, plus write-once fields) ──────────────────────────

function DetailsTab({ profile }: { profile: Profile }) {
  const { data: restaurants } = useRestaurants();
  const { rows: pending, reload } = usePendingRequests(profile.id);
  const [form, setForm] = useState<Partial<Profile>>(profile);
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(profile), [profile]);

  const set = (k: keyof Profile, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const home = restaurants?.find((r) => r.id === profile.home_restaurant_id);

  const nameLocked = !!profile.legal_first_name;
  const dobLocked = !!profile.date_of_birth;

  const nameChanged =
    (form.legal_first_name ?? "") !== (profile.legal_first_name ?? "") ||
    (form.legal_last_name ?? "") !== (profile.legal_last_name ?? "") ||
    (form.legal_middle_name ?? "") !== (profile.legal_middle_name ?? "") ||
    (form.date_of_birth ?? "") !== (profile.date_of_birth ?? "");

  const save = async () => {
    setBusy(true);
    try {
      // Anything the employee owns outright goes straight in.
      const { error } = await supabase
        .from("profiles")
        .update({
          preferred_name: form.preferred_name?.trim() || null,
          phone: form.phone?.trim() || null,
          contact_email: form.contact_email?.trim() || null,
          address_line1: form.address_line1?.trim() || null,
          address_line2: form.address_line2?.trim() || null,
          suburb: form.suburb?.trim() || null,
          address_state: form.address_state || null,
          postcode: form.postcode?.trim() || null,
          emergency_name: form.emergency_name?.trim() || null,
          emergency_relationship: form.emergency_relationship?.trim() || null,
          emergency_phone: form.emergency_phone?.trim() || null,
          emergency_phone_alt: form.emergency_phone_alt?.trim() || null,
          medical_notes: form.medical_notes?.trim() || null,
          // Write-once: allowed straight through only while still empty.
          ...(nameLocked ? {} : {
            legal_first_name: form.legal_first_name?.trim() || null,
            legal_middle_name: form.legal_middle_name?.trim() || null,
            legal_last_name: form.legal_last_name?.trim() || null,
          }),
          ...(dobLocked ? {} : { date_of_birth: form.date_of_birth || null }),
        })
        .eq("id", profile.id);
      if (error) throw error;

      // Legal name / DOB changes after the fact need sign-off — wages and the
      // signed contract both hang off them.
      if ((nameLocked || dobLocked) && nameChanged) {
        await submitChange(profile.id, "profile", {
          legal_first_name: form.legal_first_name ?? null,
          legal_middle_name: form.legal_middle_name ?? null,
          legal_last_name: form.legal_last_name ?? null,
          date_of_birth: form.date_of_birth ?? null,
        });
        reload();
        toast.success("Saved. Your name/date of birth change was sent for approval.");
      } else {
        toast.success("Saved");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {pending.some((r) => r.scope === "profile") && (
        <PendingNote text="You have a name or date-of-birth change waiting for approval." />
      )}

      <Card title="About you">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Legal first name" hint={nameLocked ? "Changes need approval." : undefined}>
            <TextInput value={form.legal_first_name ?? ""} onChange={(v) => set("legal_first_name", v)} />
          </Field>
          <Field label="Legal last name" hint={nameLocked ? "Changes need approval." : undefined}>
            <TextInput value={form.legal_last_name ?? ""} onChange={(v) => set("legal_last_name", v)} />
          </Field>
          <Field label="Middle name">
            <TextInput value={form.legal_middle_name ?? ""} onChange={(v) => set("legal_middle_name", v)} />
          </Field>
          <Field label="What you go by">
            <TextInput value={form.preferred_name ?? ""} onChange={(v) => set("preferred_name", v)} />
          </Field>
          <Field label="Date of birth" hint={dobLocked ? "Changes need approval." : undefined}>
            <TextInput type="date" value={form.date_of_birth ?? ""} onChange={(v) => set("date_of_birth", v)} />
          </Field>
          <Field label="Mobile">
            <TextInput type="tel" value={form.phone ?? ""} onChange={(v) => set("phone", v)} />
          </Field>
          <Field label="Email" className="sm:col-span-2">
            <TextInput type="email" value={form.contact_email ?? ""} onChange={(v) => set("contact_email", v)} />
          </Field>
        </div>
      </Card>

      <Card title="Address">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Street address" className="sm:col-span-2">
            <TextInput value={form.address_line1 ?? ""} onChange={(v) => set("address_line1", v)} />
          </Field>
          <Field label="Unit / building" className="sm:col-span-2">
            <TextInput value={form.address_line2 ?? ""} onChange={(v) => set("address_line2", v)} />
          </Field>
          <Field label="Suburb">
            <TextInput value={form.suburb ?? ""} onChange={(v) => set("suburb", v)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="State">
              <SelectInput value={form.address_state ?? ""} onChange={(v) => set("address_state", v)} options={AU_STATES} placeholder="—" />
            </Field>
            <Field label="Postcode">
              <TextInput inputMode="numeric" maxLength={4} value={form.postcode ?? ""} onChange={(v) => set("postcode", v)} />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Emergency contact">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><TextInput value={form.emergency_name ?? ""} onChange={(v) => set("emergency_name", v)} /></Field>
          <Field label="Relationship"><TextInput value={form.emergency_relationship ?? ""} onChange={(v) => set("emergency_relationship", v)} /></Field>
          <Field label="Phone"><TextInput type="tel" value={form.emergency_phone ?? ""} onChange={(v) => set("emergency_phone", v)} /></Field>
          <Field label="Another number"><TextInput type="tel" value={form.emergency_phone_alt ?? ""} onChange={(v) => set("emergency_phone_alt", v)} /></Field>
          <Field label="Anything we should know in an emergency?" className="sm:col-span-2">
            <TextInput value={form.medical_notes ?? ""} onChange={(v) => set("medical_notes", v)} />
          </Field>
        </div>
      </Card>

      <SigningAuthorityCard profile={profile} />

      <Card title="Your job" icon={Lock}>
        <p className="mb-3 text-xs text-muted-foreground">
          Set by the office. If something here is wrong, talk to your manager.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <ReadOnly label="Position" value={profile.position_title} />
          <ReadOnly label="Employment type" value={EMPLOYMENT_LABELS[profile.employment_type ?? ""]} />
          <ReadOnly label="Store" value={home?.name} />
          <ReadOnly label="Start date" value={profile.start_date} />
          <ReadOnly label="Award level" value={profile.award_level ? `Level ${profile.award_level}` : null} />
          <ReadOnly
            label={profile.pay_type === "salary" ? "Salary" : "Base hourly rate"}
            value={
              profile.pay_type === "salary"
                ? profile.salary_annual != null ? `$${profile.salary_annual.toLocaleString()}` : null
                : profile.base_pay_rate != null ? `$${profile.base_pay_rate.toFixed(2)}` : "Award rate"
            }
          />
        </div>
      </Card>

      <button
        onClick={save}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save changes
      </button>
    </div>
  );
}

/**
 * Your signature, used when YOU are the one who onboarded someone — their
 * contract is issued in the name of whoever started their onboarding, so each
 * authoriser needs their own name, title and signature on file.
 */
function SigningAuthorityCard({ profile }: { profile: Profile }) {
  const { role: effectiveRole } = usePermissions();
  const [title, setTitle] = useState(profile.signatory_title ?? "");
  const [image, setImage] = useState(profile.signature_image ?? "");
  const [busy, setBusy] = useState(false);

  // Only people who can start someone's onboarding ever sign a contract.
  // Effective role, so this hides while previewing staff mode.
  if (!["superadmin", "area_manager", "manager"].includes(effectiveRole ?? "")) return null;

  const onFile = (file: File | null) => {
    if (!file) return;
    if (file.size > 400_000) { toast.error("Signature image must be under 400 KB"); return; }
    const reader = new FileReader();
    reader.onload = () => setImage(String(reader.result));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setBusy(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ signatory_title: title.trim() || null, signature_image: image || null })
        .eq("id", profile.id);
      if (error) throw error;
      toast.success("Signature saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Your signature (for contracts you authorise)" icon={PenLine}>
      <p className="mb-3 text-xs text-muted-foreground">
        When you onboard a team member, their contract is issued and counter-signed in your name.
        Set the title and signature you want printed. Leave them blank to fall back to the company
        signatory.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your title" hint="e.g. Director, Store Manager">
          <TextInput value={title} onChange={setTitle} />
        </Field>
        <Field label="Signature image" hint="PNG with a transparent background. Under 400 KB.">
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm"
          />
        </Field>
      </div>
      {image && (
        <div className="mt-3 flex items-center gap-3">
          <img src={image} alt="Your signature" className="h-12 rounded border border-border bg-white p-1" />
          <button onClick={() => setImage("")} className="text-xs text-muted-foreground hover:text-destructive">
            Remove
          </button>
        </div>
      )}
      <button
        onClick={save}
        disabled={busy}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save signature
      </button>
    </Card>
  );
}

// ── Pay details (bank / super — approval required) ──────────────────────────

function MoneyTab({ profile }: { profile: Profile }) {
  const { data, isLoading } = useEmployeeSensitive(profile.id);
  const { rows: pending, reload } = usePendingRequests(profile.id);
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data) {
      setForm({
        super_choice: data.super_choice ?? "",
        super_fund_name: data.super_fund_name ?? "",
        super_usi: data.super_usi ?? "",
        super_member_number: data.super_member_number ?? "",
        bank_account_name: data.bank_account_name ?? "",
        bank_bsb: data.bank_bsb ?? "",
        bank_account_number: data.bank_account_number ?? "",
      });
    }
  }, [data]);

  const hasPending = pending.some((r) => r.scope === "sensitive");

  const submit = async () => {
    setBusy(true);
    try {
      await submitChange(profile.id, "sensitive", form);
      reload();
      setEdit(false);
      toast.success("Sent for approval — your pay details won't change until it's approved.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-2 rounded-lg border border-border bg-muted/40 p-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-xs text-muted-foreground">
          Only you and the business owner can see these. Changes to your bank or super are checked
          before they take effect — that's what stops someone redirecting your pay.
        </p>
      </div>

      {hasPending && <PendingNote text="You have a bank or super change waiting for approval." />}

      {!edit ? (
        <>
          <Card title="Super">
            <div className="grid gap-4 sm:grid-cols-2">
              <ReadOnly label="Fund" value={data?.super_choice === "employer_default" ? "Employer default fund" : data?.super_fund_name} />
              <ReadOnly label="Member number" value={mask(data?.super_member_number)} />
            </div>
          </Card>
          <Card title="Bank">
            <div className="grid gap-4 sm:grid-cols-3">
              <ReadOnly label="Account name" value={data?.bank_account_name} />
              <ReadOnly label="BSB" value={mask(data?.bank_bsb)} />
              <ReadOnly label="Account number" value={mask(data?.bank_account_number)} />
            </div>
          </Card>
          <button
            onClick={() => setEdit(true)}
            disabled={hasPending}
            className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
          >
            Request a change
          </button>
        </>
      ) : (
        <Card title="Request a change">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Super" className="sm:col-span-2">
              <SelectInput
                value={form.super_choice ?? ""}
                onChange={(v) => setForm((f) => ({ ...f, super_choice: v }))}
                placeholder="—"
                options={[
                  { value: "employer_default", label: "Employer default fund" },
                  { value: "own_fund", label: "My own fund" },
                ]}
              />
            </Field>
            {form.super_choice === "own_fund" && (
              <>
                <Field label="Fund name"><TextInput value={form.super_fund_name ?? ""} onChange={(v) => setForm((f) => ({ ...f, super_fund_name: v }))} /></Field>
                <Field label="USI"><TextInput value={form.super_usi ?? ""} onChange={(v) => setForm((f) => ({ ...f, super_usi: v }))} /></Field>
                <Field label="Member number" className="sm:col-span-2">
                  <TextInput value={form.super_member_number ?? ""} onChange={(v) => setForm((f) => ({ ...f, super_member_number: v }))} />
                </Field>
              </>
            )}
            <Field label="Account name" className="sm:col-span-2">
              <TextInput value={form.bank_account_name ?? ""} onChange={(v) => setForm((f) => ({ ...f, bank_account_name: v }))} />
            </Field>
            <Field label="BSB"><TextInput inputMode="numeric" value={form.bank_bsb ?? ""} onChange={(v) => setForm((f) => ({ ...f, bank_bsb: v }))} /></Field>
            <Field label="Account number"><TextInput inputMode="numeric" value={form.bank_account_number ?? ""} onChange={(v) => setForm((f) => ({ ...f, bank_account_number: v }))} /></Field>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={submit}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />}
              Send for approval
            </button>
            <button onClick={() => setEdit(false)} className="rounded-md border border-border px-3 py-2 text-sm">Cancel</button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Documents ───────────────────────────────────────────────────────────────

function DocumentsTab({ profile }: { profile: Profile }) {
  const { data: docs } = useEmployeeDocuments(profile.id);
  const { upload, remove, signedUrl } = useDocumentActions();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState("food_handler");
  const [expires, setExpires] = useState("");

  const add = async () => {
    if (!file) { toast.error("Choose a file first."); return; }
    try {
      await upload.mutateAsync({
        employeeId: profile.id,
        file,
        kind: kind as EmployeeDocument["kind"],
        expiresOn: expires || null,
      });
      setFile(null); setExpires("");
      toast.success("Uploaded");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      <Card title="Add a certificate">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Type">
            <SelectInput
              value={kind}
              onChange={setKind}
              options={[
                { value: "food_handler", label: "Food handler" },
                { value: "rsa", label: "RSA" },
                { value: "visa", label: "Visa" },
                { value: "qualification", label: "Qualification" },
                { value: "other", label: "Other" },
              ]}
            />
          </Field>
          <Field label="Expires"><TextInput type="date" value={expires} onChange={setExpires} /></Field>
          <Field label="File">
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
          Upload
        </button>
      </Card>

      {!docs?.length ? (
        <p className="text-sm text-muted-foreground">Nothing uploaded yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {docs.map((d) => {
            const expired = d.expires_on && new Date(d.expires_on) < new Date();
            return (
              <li key={d.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{d.label || d.kind}</p>
                  <p className={cn("text-xs", expired ? "text-destructive" : "text-muted-foreground")}>
                    {d.expires_on ? `${expired ? "Expired" : "Expires"} ${format(new Date(d.expires_on), "d MMM yyyy")}` : "No expiry"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {d.file_path && (
                    <button
                      onClick={async () => window.open(await signedUrl(d.file_path!), "_blank")}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                    >
                      <FileText className="h-4 w-4" />
                    </button>
                  )}
                  <button onClick={() => remove.mutate(d)} className="rounded-md p-1.5 text-muted-foreground hover:text-destructive">
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

// ── Contracts ───────────────────────────────────────────────────────────────

function ContractsTab({ profile }: { profile: Profile }) {
  const { data: contracts, isLoading } = useEmployeeContracts(profile.id);
  const { data: company } = useCompanySettings();

  const signed = useMemo(
    () => (contracts ?? []).filter((c) => c.status === "signed" || c.status === "superseded"),
    [contracts]
  );

  if (isLoading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!signed.length) {
    return <p className="text-sm text-muted-foreground">No signed contracts yet.</p>;
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {signed.map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {c.template_name ?? (c.kind === "variation" ? "Variation of terms" : "Employment agreement")}
            </p>
            <p className="text-xs text-muted-foreground">
              {c.signed_at ? `Signed ${format(new Date(c.signed_at), "d MMM yyyy")}` : "Not signed"}
              {c.status === "superseded" && " · replaced"}
            </p>
          </div>
          <button
            onClick={() => {
              if (!company) return;
              try {
                printContract(renderSignedDocument(c, company), "Employment agreement");
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm"
          >
            <Download className="h-4 w-4" /> Open / save PDF
          </button>
        </li>
      ))}
    </ul>
  );
}

// ── bits ────────────────────────────────────────────────────────────────────

function Card({
  title, icon: Icon, children,
}: {
  title: string; icon?: typeof Lock; children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
        {title}
      </h3>
      {children}
    </div>
  );
}

function PendingNote({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-sm text-foreground">
      <Clock3 className="h-4 w-4 shrink-0 text-sky-600" />
      {text}
    </div>
  );
}
