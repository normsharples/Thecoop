import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, Check, Loader2, LogOut, PartyPopper, ShieldCheck, FileText,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useRestaurants } from "@/hooks/useRestaurants";
import {
  useMyOnboarding, useTouchStep, useEmployeeSensitive, useSaveSensitive,
  useCompanySettings, useDocumentActions,
} from "@/hooks/useOnboarding";
import { useMyOpenContract, useSignContract, useMarkViewed, useAutoIssueContract } from "@/hooks/useContracts";
import { CONTRACT_CSS, withSignature } from "@/lib/contract";
import { Field, TextInput, SelectInput, ReadOnly, AU_STATES } from "@/components/onboarding/fields";
import SignaturePad from "@/components/onboarding/SignaturePad";
import type { Profile } from "@/types";

const STEPS = [
  "Your details",
  "Emergency contact",
  "Work eligibility",
  "Your job",
  "Tax, super & bank",
  "Your contract",
] as const;

const EMPLOYMENT_LABELS: Record<string, string> = {
  casual: "Casual",
  part_time: "Part-time",
  full_time: "Full-time",
};

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const { data: onboarding, isLoading } = useMyOnboarding();
  const { data: restaurants } = useRestaurants();
  const { data: sensitive } = useEmployeeSensitive(profile?.id);
  const { data: company } = useCompanySettings();
  const { data: contract, refetch: refetchContract } = useMyOpenContract();
  const touch = useTouchStep();
  const saveSensitive = useSaveSensitive();
  const sign = useSignContract();
  const markViewed = useMarkViewed();
  const { upload } = useDocumentActions();
  const autoIssue = useAutoIssueContract();

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [p, setP] = useState<Partial<Profile>>({});
  const [s, setS] = useState<Record<string, string | boolean | null>>({ tax_free_threshold: true });
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certExpiry, setCertExpiry] = useState("");
  const [ackRead, setAckRead] = useState(false);
  const [ackAgree, setAckAgree] = useState(false);
  const [sigName, setSigName] = useState("");
  const [sigImage, setSigImage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [issueReason, setIssueReason] = useState<string | null>(null);

  const isManagerPlus = profile
    ? ["superadmin", "area_manager", "manager"].includes(profile.role)
    : false;

  useEffect(() => { if (profile) setP({ ...profile }); }, [profile]);
  useEffect(() => { if (sensitive) setS({ ...sensitive } as Record<string, string | boolean | null>); }, [sensitive]);
  useEffect(() => {
    if (onboarding?.current_step) setStep((cur) => Math.max(cur, Math.min(onboarding.current_step, 6)));
  }, [onboarding?.current_step]);
  useEffect(() => {
    if (profile && !sigName) {
      setSigName([profile.legal_first_name, profile.legal_last_name].filter(Boolean).join(" ") || profile.full_name);
    }
  }, [profile, sigName]);

  const home = restaurants?.find((r) => r.id === profile?.home_restaurant_id);

  // Steps the person actually has to do.
  const activeSteps = useMemo(() => {
    const list: number[] = [];
    if (onboarding?.collect_details !== false) list.push(1, 2, 3, 4, 5);
    if (onboarding?.issue_contract !== false) list.push(6);
    return list.length ? list : [1, 2, 3, 4, 5, 6];
  }, [onboarding]);

  const setPf = (k: keyof Profile, v: string | number | null) => setP((f) => ({ ...f, [k]: v }));
  const setSf = (k: string, v: string | boolean) => setS((f) => ({ ...f, [k]: v }));
  const str = (k: string) => (s[k] as string) ?? "";

  if (isLoading || !profile) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Validation per step ───────────────────────────────────────────────────
  const problems = (n: number): string[] => {
    const out: string[] = [];
    if (n === 1) {
      if (!p.legal_first_name?.trim()) out.push("Legal first name");
      if (!p.legal_last_name?.trim()) out.push("Legal last name");
      if (!p.date_of_birth) out.push("Date of birth");
      if (!p.phone?.trim()) out.push("Mobile number");
      if (!p.address_line1?.trim()) out.push("Street address");
      if (!p.suburb?.trim()) out.push("Suburb");
      if (!p.address_state) out.push("State");
      if (!/^\d{4}$/.test(p.postcode ?? "")) out.push("A 4-digit postcode");
    }
    if (n === 2) {
      if (!p.emergency_name?.trim()) out.push("Emergency contact name");
      if (!p.emergency_phone?.trim()) out.push("Emergency contact phone");
    }
    if (n === 3) {
      if (!p.work_eligibility) out.push("Your work eligibility");
      if (p.work_eligibility === "visa") {
        if (!p.visa_subclass?.trim()) out.push("Visa subclass");
        if (!p.visa_expiry) out.push("Visa expiry");
      }
    }
    if (n === 5) {
      if (!str("tfn") && !str("tfn_exemption")) out.push("A tax file number, or a reason you're not giving one");
      if (!str("tax_residency")) out.push("Residency for tax");
      if (!str("super_choice")) out.push("A super choice");
      if (str("super_choice") === "own_fund") {
        if (!str("super_fund_name")) out.push("Super fund name");
        if (!str("super_member_number")) out.push("Super member number");
      }
      if (!str("bank_account_name")) out.push("Bank account name");
      if (!/^\d{3}-?\d{3}$/.test(str("bank_bsb").replace(/\s/g, ""))) out.push("A valid BSB (6 digits)");
      if (!/^\d{5,10}$/.test(str("bank_account_number").replace(/\s/g, ""))) out.push("A valid account number");
    }
    return out;
  };

  const saveProfilePart = async () => {
    const patch: Partial<Profile> = {
      legal_first_name: p.legal_first_name?.trim() || null,
      legal_middle_name: p.legal_middle_name?.trim() || null,
      legal_last_name: p.legal_last_name?.trim() || null,
      preferred_name: p.preferred_name?.trim() || null,
      date_of_birth: p.date_of_birth || null,
      phone: p.phone?.trim() || null,
      contact_email: p.contact_email?.trim() || null,
      address_line1: p.address_line1?.trim() || null,
      address_line2: p.address_line2?.trim() || null,
      suburb: p.suburb?.trim() || null,
      address_state: p.address_state || null,
      postcode: p.postcode?.trim() || null,
      emergency_name: p.emergency_name?.trim() || null,
      emergency_relationship: p.emergency_relationship?.trim() || null,
      emergency_phone: p.emergency_phone?.trim() || null,
      emergency_phone_alt: p.emergency_phone_alt?.trim() || null,
      medical_notes: p.medical_notes?.trim() || null,
      work_eligibility: p.work_eligibility ?? null,
      visa_subclass: p.visa_subclass?.trim() || null,
      visa_expiry: p.visa_expiry || null,
    };
    const { error } = await supabase.from("profiles").update(patch).eq("id", profile.id);
    if (error) throw error;
  };

  const next = async () => {
    const issues = problems(step);
    if (issues.length) {
      toast.error(`Still needed: ${issues.join(", ")}`);
      return;
    }
    setBusy(true);
    try {
      if (step <= 3) await saveProfilePart();
      if (step === 3 && certFile) {
        await upload.mutateAsync({
          employeeId: profile.id,
          file: certFile,
          kind: "food_handler",
          label: "Food handler certificate",
          expiresOn: certExpiry || null,
        });
        setCertFile(null);
      }
      if (step === 5) {
        await saveSensitive.mutateAsync({
          employeeId: profile.id,
          patch: {
            tfn: str("tfn") || null,
            tfn_exemption: (str("tfn_exemption") || null) as never,
            tax_free_threshold: !!s.tax_free_threshold,
            help_debt: !!s.help_debt,
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
      }
      // Their half is now complete — ask the server to issue the contract.
      // It no-ops unless the employment terms are set too, so this is safe to
      // fire every time and means nobody has to press "send".
      if (step === 5 && onboarding?.issue_contract !== false) {
        try {
          const res = await autoIssue.mutateAsync({});
          if (!res?.issued) {
            // Not the employee's problem, but leave a trail: a silent failure
            // here looks identical to "your manager hasn't finished", which
            // sent us hunting the wrong thing once already.
            console.warn("[onboarding] contract not issued:", res?.reason, res?.blockers ?? res?.detail);
            setIssueReason(res?.reason ?? null);
          }
        } catch (e) {
          console.error("[onboarding] issue-contract call failed:", e);
          setIssueReason("call_failed");
        }
      }

      const nextStep = activeSteps.find((n) => n > step);
      if (nextStep) {
        await touch.mutateAsync(nextStep);
        setStep(nextStep);
        if (nextStep === 6) await refetchContract();
        window.scrollTo({ top: 0 });
      } else {
        setDone(true);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    const prev = [...activeSteps].reverse().find((n) => n < step);
    if (prev) { setStep(prev); window.scrollTo({ top: 0 }); }
  };

  const doSign = async () => {
    if (!contract) return;
    if (!ackRead || !ackAgree) { toast.error("Please tick both boxes to confirm."); return; }
    if (!sigName.trim()) { toast.error("Type your full legal name to sign."); return; }
    setBusy(true);
    try {
      await sign.mutateAsync({ contractId: contract.id, name: sigName.trim(), signature: sigImage });
      setDone(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done || onboarding?.status === "complete") {
    return (
      <FullScreen>
        <div className="mx-auto max-w-md space-y-4 text-center">
          <PartyPopper className="mx-auto h-12 w-12 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">You're all set</h1>
          <p className="text-sm text-muted-foreground">
            Thanks {p.preferred_name || p.legal_first_name || profile.full_name}. Your details are
            saved{onboarding?.issue_contract === false ? "" : " and your contract is signed"}. You can
            update your contact details any time from My Profile.
          </p>
          <button
            onClick={() => { try { sessionStorage.removeItem("coop.onboarding.dismissed"); } catch { /* ignore */ } navigate("/"); }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Go to the app
          </button>
        </div>
      </FullScreen>
    );
  }

  const stepIndex = activeSteps.indexOf(step);

  return (
    <FullScreen>
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-foreground">Welcome to the team</h1>
              <p className="text-sm text-muted-foreground">
                {home ? `${home.name} · ` : ""}A few details before you start.
              </p>
            </div>
            <button
              onClick={() => signOut()}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>

          <div className="mt-4 flex gap-1.5">
            {activeSteps.map((n, i) => (
              <div
                key={n}
                className={cn(
                  "h-1.5 flex-1 rounded-full",
                  i <= stepIndex ? "bg-primary" : "bg-muted"
                )}
              />
            ))}
          </div>
          <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Step {stepIndex + 1} of {activeSteps.length} — {STEPS[step - 1]}
          </p>
        </header>

        <div className="rounded-lg border border-border bg-card p-5">
          {step === 1 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Legal first name" required>
                <TextInput value={p.legal_first_name ?? ""} onChange={(v) => setPf("legal_first_name", v)} autoComplete="given-name" />
              </Field>
              <Field label="Legal last name" required>
                <TextInput value={p.legal_last_name ?? ""} onChange={(v) => setPf("legal_last_name", v)} autoComplete="family-name" />
              </Field>
              <Field label="Middle name">
                <TextInput value={p.legal_middle_name ?? ""} onChange={(v) => setPf("legal_middle_name", v)} />
              </Field>
              <Field label="What do you go by?" hint="This is the name we'll show on the roster.">
                <TextInput value={p.preferred_name ?? ""} onChange={(v) => setPf("preferred_name", v)} />
              </Field>
              <Field label="Date of birth" required hint="We need this for your pay rate.">
                <TextInput type="date" value={p.date_of_birth ?? ""} onChange={(v) => setPf("date_of_birth", v)} />
              </Field>
              <Field label="Mobile" required>
                <TextInput type="tel" value={p.phone ?? ""} onChange={(v) => setPf("phone", v)} autoComplete="tel" />
              </Field>
              <Field label="Email" className="sm:col-span-2">
                <TextInput type="email" value={p.contact_email ?? ""} onChange={(v) => setPf("contact_email", v)} autoComplete="email" />
              </Field>
              <Field label="Street address" required className="sm:col-span-2">
                <TextInput value={p.address_line1 ?? ""} onChange={(v) => setPf("address_line1", v)} autoComplete="address-line1" />
              </Field>
              <Field label="Unit / building" className="sm:col-span-2">
                <TextInput value={p.address_line2 ?? ""} onChange={(v) => setPf("address_line2", v)} />
              </Field>
              <Field label="Suburb" required>
                <TextInput value={p.suburb ?? ""} onChange={(v) => setPf("suburb", v)} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="State" required>
                  <SelectInput value={p.address_state ?? ""} onChange={(v) => setPf("address_state", v)} options={AU_STATES} placeholder="—" />
                </Field>
                <Field label="Postcode" required>
                  <TextInput inputMode="numeric" maxLength={4} value={p.postcode ?? ""} onChange={(v) => setPf("postcode", v)} />
                </Field>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <p className="text-sm text-muted-foreground sm:col-span-2">
                Who should we call if something happens to you at work?
              </p>
              <Field label="Their name" required>
                <TextInput value={p.emergency_name ?? ""} onChange={(v) => setPf("emergency_name", v)} />
              </Field>
              <Field label="Relationship to you">
                <TextInput value={p.emergency_relationship ?? ""} onChange={(v) => setPf("emergency_relationship", v)} placeholder="e.g. Mum, partner" />
              </Field>
              <Field label="Their phone" required>
                <TextInput type="tel" value={p.emergency_phone ?? ""} onChange={(v) => setPf("emergency_phone", v)} />
              </Field>
              <Field label="Another number">
                <TextInput type="tel" value={p.emergency_phone_alt ?? ""} onChange={(v) => setPf("emergency_phone_alt", v)} />
              </Field>
              <Field
                label="Anything we should know in an emergency?"
                className="sm:col-span-2"
                hint="Allergies, a condition, medication. Optional — only what would matter if you needed help."
              >
                <TextInput value={p.medical_notes ?? ""} onChange={(v) => setPf("medical_notes", v)} />
              </Field>
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Your right to work in Australia" required className="sm:col-span-2">
                <SelectInput
                  value={p.work_eligibility ?? ""}
                  onChange={(v) => setPf("work_eligibility", v)}
                  placeholder="Select…"
                  options={[
                    { value: "citizen", label: "Australian citizen" },
                    { value: "permanent_resident", label: "Permanent resident" },
                    { value: "visa", label: "I'm here on a visa" },
                  ]}
                />
              </Field>
              {p.work_eligibility === "visa" && (
                <>
                  <Field label="Visa subclass" required>
                    <TextInput value={p.visa_subclass ?? ""} onChange={(v) => setPf("visa_subclass", v)} placeholder="e.g. 500" />
                  </Field>
                  <Field label="Visa expiry" required>
                    <TextInput type="date" value={p.visa_expiry ?? ""} onChange={(v) => setPf("visa_expiry", v)} />
                  </Field>
                </>
              )}
              <div className="sm:col-span-2 rounded-md border border-border p-3">
                <p className="text-sm font-medium text-foreground">Food handler certificate</p>
                <p className="mb-2 text-xs text-muted-foreground">
                  Optional now — you can add it later from My Profile.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Photo or PDF">
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) => setCertFile(e.target.files?.[0] ?? null)}
                      className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm"
                    />
                  </Field>
                  <Field label="Expires">
                    <TextInput type="date" value={certExpiry} onChange={setCertExpiry} />
                  </Field>
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This is what we have on file for your job. If anything looks wrong, tell your manager
                before you sign — these can only be changed by the office.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
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
                      : profile.base_pay_rate != null ? `$${profile.base_pay_rate.toFixed(2)}` : "Set from the award"
                  }
                />
              </div>
              <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                Penalty rates for evenings, weekends, public holidays and overtime are applied
                automatically under the Fast Food Award (MA000003) on top of your base rate.
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <div className="flex gap-2 rounded-md border border-border bg-muted/40 p-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-xs text-muted-foreground">
                  Your tax file number, super and bank details are only visible to you and the
                  business owner. Managers cannot see this page.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Tax file number">
                  <TextInput inputMode="numeric" value={str("tfn")} onChange={(v) => setSf("tfn", v)} />
                </Field>
                <Field label="…or tell us why not">
                  <SelectInput
                    value={str("tfn_exemption")}
                    onChange={(v) => setSf("tfn_exemption", v)}
                    placeholder="—"
                    options={[
                      { value: "applied", label: "I've applied for one" },
                      { value: "under_18", label: "Under 18 and under the threshold" },
                      { value: "pensioner", label: "Pensioner" },
                      { value: "not_provided", label: "I'd rather not provide it" },
                    ]}
                  />
                </Field>
                <Field label="Residency for tax" required>
                  <SelectInput
                    value={str("tax_residency")}
                    onChange={(v) => setSf("tax_residency", v)}
                    placeholder="Select…"
                    options={[
                      { value: "resident", label: "Australian resident" },
                      { value: "foreign", label: "Foreign resident" },
                      { value: "working_holiday", label: "Working holiday maker" },
                    ]}
                  />
                </Field>
                <div className="flex flex-col justify-end gap-2 pb-1">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!s.tax_free_threshold} onChange={(e) => setSf("tax_free_threshold", e.target.checked)} className="h-4 w-4" />
                    Claim the tax-free threshold
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!s.help_debt} onChange={(e) => setSf("help_debt", e.target.checked)} className="h-4 w-4" />
                    I have a HELP/HECS debt
                  </label>
                </div>

                <Field label="Superannuation" required className="sm:col-span-2">
                  <SelectInput
                    value={str("super_choice")}
                    onChange={(v) => setSf("super_choice", v)}
                    placeholder="Select…"
                    options={[
                      { value: "employer_default", label: "Use the employer's default fund" },
                      { value: "own_fund", label: "I have my own fund" },
                    ]}
                  />
                </Field>
                {str("super_choice") === "own_fund" && (
                  <>
                    <Field label="Fund name" required>
                      <TextInput value={str("super_fund_name")} onChange={(v) => setSf("super_fund_name", v)} />
                    </Field>
                    <Field label="USI" hint="On your super statement.">
                      <TextInput value={str("super_usi")} onChange={(v) => setSf("super_usi", v)} />
                    </Field>
                    <Field label="Member number" required className="sm:col-span-2">
                      <TextInput value={str("super_member_number")} onChange={(v) => setSf("super_member_number", v)} />
                    </Field>
                  </>
                )}

                <Field label="Account name" required className="sm:col-span-2">
                  <TextInput value={str("bank_account_name")} onChange={(v) => setSf("bank_account_name", v)} />
                </Field>
                <Field label="BSB" required>
                  <TextInput inputMode="numeric" placeholder="063-000" value={str("bank_bsb")} onChange={(v) => setSf("bank_bsb", v)} />
                </Field>
                <Field label="Account number" required>
                  <TextInput inputMode="numeric" value={str("bank_account_number")} onChange={(v) => setSf("bank_account_number", v)} />
                </Field>
              </div>
            </div>
          )}

          {step === 6 && (
            <ContractStep
              issueReason={issueReason}
              contract={contract ?? null}
              companySignature={company?.signature_image ?? null}
              onView={() => contract && markViewed.mutate(contract.id)}
              ackRead={ackRead}
              setAckRead={setAckRead}
              ackAgree={ackAgree}
              setAckAgree={setAckAgree}
              sigName={sigName}
              setSigName={setSigName}
              setSigImage={setSigImage}
            />
          )}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={back}
            disabled={stepIndex === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm disabled:opacity-40"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          <div className="flex items-center gap-2">
            {(onboarding?.skip_allowed || isManagerPlus) && (
              <button
                onClick={() => {
                  // Dismiss the soft gate for this browser session only — it
                  // comes back at the next login until onboarding is finished.
                  try { sessionStorage.setItem("coop.onboarding.dismissed", "1"); } catch { /* private mode */ }
                  navigate("/");
                }}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                {isManagerPlus ? "Continue to dashboard" : "Skip for now"}
              </button>
            )}
            {step === 6 && !contract ? (
              // Nothing has been issued yet — the hold-up is on our side, so
              // never leave them staring at a disabled button.
              <button
                onClick={() => navigate("/")}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                <Check className="h-4 w-4" />
                Done for now
              </button>
            ) : step === 6 ? (
              <button
                onClick={doSign}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Sign and finish
              </button>
            ) : (
              <button
                onClick={next}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Continue
              </button>
            )}
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Starting a shift?{" "}
          <button onClick={() => navigate("/clock")} className="underline hover:text-foreground">
            Clock in or out here
          </button>{" "}
          — you never need to finish this first.
        </p>
      </div>
    </FullScreen>
  );
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full overflow-y-auto bg-background px-4 py-8">
      {children}
    </div>
  );
}

// ── Step 6 ──────────────────────────────────────────────────────────────────

function ContractStep({
  contract, companySignature, onView, ackRead, setAckRead, ackAgree, setAckAgree,
  sigName, setSigName, setSigImage, issueReason,
}: {
  issueReason?: string | null;
  contract: ReturnType<typeof useMyOpenContract>["data"];
  companySignature: string | null;
  onView: () => void;
  ackRead: boolean;
  setAckRead: (v: boolean) => void;
  ackAgree: boolean;
  setAckAgree: (v: boolean) => void;
  sigName: string;
  setSigName: (v: string) => void;
  setSigImage: (v: string | null) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [reachedEnd, setReachedEnd] = useState(false);
  const viewed = useRef(false);

  useEffect(() => {
    if (contract && !viewed.current) { viewed.current = true; onView(); }
  }, [contract, onView]);

  const html = useMemo(() => {
    if (!contract) return "";
    return withSignature(contract.body_html, {
      employeeName: contract.tokens?.["employee.legal_name"] ?? null,
      employerName: contract.employer_signatory_name,
      employerTitle: contract.employer_signatory_title,
      employerSignature: contract.employer_signature_image || companySignature,
      employerSignedAt: contract.employer_signed_at,
    });
  }, [contract, companySignature]);

  if (!contract) {
    return (
      <div className="py-8 text-center">
        <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">
          Your details are saved. Your contract isn't ready yet — it'll arrive automatically once
          your manager has finished setting up your pay, and you'll get a notification. Nothing else
          for you to do right now.
        </p>
        {issueReason && issueReason !== "not_ready" && (
          <p className="mx-auto mt-3 max-w-sm rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-muted-foreground">
            Setup note for your manager:{" "}
            <span className="font-medium text-foreground">
              {issueReason === "setup_incomplete"
                ? "migration 065 has not been applied"
                : issueReason === "call_failed"
                  ? "the issue-contract function is not reachable — it may not be deployed"
                  : issueReason === "no_template"
                    ? "no contract template matches this role"
                    : issueReason}
            </span>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) setReachedEnd(true);
        }}
        className="max-h-[420px] overflow-y-auto rounded-md border border-border bg-white p-5"
      >
        <style>{CONTRACT_CSS}</style>
        <div className="contract-doc" dangerouslySetInnerHTML={{ __html: html }} />
      </div>

      {!reachedEnd && (
        <p className="text-xs text-muted-foreground">Scroll to the bottom to read the whole agreement.</p>
      )}

      <div className="space-y-2">
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" checked={ackRead} onChange={(e) => setAckRead(e.target.checked)} disabled={!reachedEnd} className="mt-0.5 h-4 w-4" />
          <span>I have read this agreement in full and had the chance to ask questions.</span>
        </label>
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" checked={ackAgree} onChange={(e) => setAckAgree(e.target.checked)} disabled={!reachedEnd} className="mt-0.5 h-4 w-4" />
          <span>I agree to the terms and I'm signing this electronically.</span>
        </label>
      </div>

      <SignaturePad name={sigName} onNameChange={setSigName} onSignatureChange={setSigImage} />
    </div>
  );
}
