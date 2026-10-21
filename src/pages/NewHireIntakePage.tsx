import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { format } from "date-fns";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ExternalLink,
  FileText,
  Link2Off,
  Loader2,
  Lock,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useNewHireIntake, useNewHireIntakeActions } from "@/hooks/useNewHires";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { OrbitWordmark } from "@/components/brand/OrbitLogo";
import { cn } from "@/lib/utils";
import type { NewHireIntake } from "@/types";

// ============================================================================
// NEW-HIRE INTAKE
// ----------------------------------------------------------------------------
// Opened from a link with no login — the token in the URL is the credential, so
// every call here is an RPC that takes it. There is no session, no nav and no
// way into the rest of ORBIT from this page.
//
// Built for a phone held in one hand: one step per screen, a saved draft after
// every step (so closing the tab loses nothing), and nothing asked twice.
//
// Step 4 is the one worth reading the code for. ORBIT does not store tax file
// numbers or bank details, so that step is a link out to the brand's payroll
// system and a single confirmation. If the brand has not set a URL we say so
// rather than pretending the step is done.
// ============================================================================

const STEPS = ["Your details", "Certificates", "Policies", "Payroll", "Finish"] as const;

const STATES = ["VIC", "NSW", "QLD", "SA", "WA", "TAS", "NT", "ACT"];

export default function NewHireIntakePage() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, isError, error } = useNewHireIntake(token);
  const [step, setStep] = useState(1);

  // Pick up where they left off.
  useEffect(() => {
    if (data?.hire) setStep(Math.min(Math.max(data.hire.current_step, 1), STEPS.length));
  }, [data?.hire.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Opening your form…
        </div>
      </Shell>
    );
  }

  if (isError || !data) {
    return (
      <Shell>
        <div className="space-y-4 py-10 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunken">
            <Link2Off className="h-5 w-5 text-muted-foreground" />
          </span>
          <div className="space-y-1.5">
            <h1 className="font-display text-xl font-semibold text-foreground">
              This link doesn't work
            </h1>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error
                ? error.message
                : "It may have expired, or already been used."}
            </p>
            <p className="text-sm text-muted-foreground">
              Ask your manager to send you a new one.
            </p>
          </div>
        </div>
      </Shell>
    );
  }

  if (data.hire.submitted_at) {
    return (
      <Shell brandName={data.brand?.name}>
        <div className="space-y-4 py-10 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-soft">
            <CheckCircle2 className="h-6 w-6 text-success" />
          </span>
          <div className="space-y-1.5">
            <h1 className="font-display text-2xl font-semibold text-foreground">
              All done, {data.hire.preferred_name || data.hire.full_name.split(" ")[0]}
            </h1>
            <p className="text-sm text-muted-foreground">
              Your manager has everything they need. They'll be in touch about your first shift.
            </p>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell brandName={data.brand?.name} venue={data.venue}>
      <Progress step={step} />
      <div className="mt-5">
        {step === 1 && <DetailsStep token={token!} data={data} onNext={() => setStep(2)} />}
        {step === 2 && (
          <CertificatesStep
            token={token!}
            data={data}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <PoliciesStep
            token={token!}
            data={data}
            onBack={() => setStep(2)}
            onNext={() => setStep(4)}
          />
        )}
        {step === 4 && (
          <PayrollStep
            token={token!}
            data={data}
            onBack={() => setStep(3)}
            onNext={() => setStep(5)}
          />
        )}
        {step === 5 && <FinishStep token={token!} data={data} onBack={() => setStep(4)} />}
      </div>
    </Shell>
  );
}

// ── Chrome ──────────────────────────────────────────────────────────────────

function Shell({
  children,
  brandName,
  venue,
}: {
  children: React.ReactNode;
  brandName?: string;
  venue?: string | null;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-4 py-3.5">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <OrbitWordmark className="text-[18px] text-foreground" />
          {brandName && (
            <span className="truncate text-[13px] text-muted-foreground">
              {brandName}
              {venue ? ` · ${venue}` : ""}
            </span>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-5 pb-24">{children}</main>
    </div>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[13px]">
        <span className="font-medium text-foreground">{STEPS[step - 1]}</span>
        <span className="text-muted-foreground">
          Step {step} of {STEPS.length}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-sunken"
        role="progressbar"
        aria-valuenow={step}
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-label="Onboarding progress"
      >
        <div
          className="h-full rounded-full bg-brand-accent transition-all duration-300"
          style={{ width: `${(step / STEPS.length) * 100}%` }}
        />
      </div>
    </div>
  );
}

function StepNav({
  onBack,
  onNext,
  nextLabel = "Next",
  nextDisabled,
  busy,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="mt-6 flex gap-2">
      {onBack && (
        <Button variant="outline" size="lg" className="flex-1" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      )}
      <Button size="lg" className="flex-1" onClick={onNext} disabled={nextDisabled || busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {nextLabel}
        {!busy && <ArrowRight className="h-4 w-4" />}
      </Button>
    </div>
  );
}

// ── Step 1: details ─────────────────────────────────────────────────────────

function DetailsStep({
  token,
  data,
  onNext,
}: {
  token: string;
  data: NewHireIntake;
  onNext: () => void;
}) {
  const { saveDetails } = useNewHireIntakeActions(token);
  const h = data.hire;
  const [form, setForm] = useState({
    legal_first_name: h.legal_first_name ?? h.full_name.split(" ")[0] ?? "",
    legal_last_name: h.legal_last_name ?? h.full_name.split(" ").slice(1).join(" ") ?? "",
    preferred_name: h.preferred_name ?? "",
    date_of_birth: h.date_of_birth ?? "",
    mobile: h.mobile ?? "",
    email: h.email ?? "",
    address_line1: h.address_line1 ?? "",
    address_line2: h.address_line2 ?? "",
    suburb: h.suburb ?? "",
    address_state: h.address_state ?? "VIC",
    postcode: h.postcode ?? "",
    emergency_name: h.emergency_name ?? "",
    emergency_relationship: h.emergency_relationship ?? "",
    emergency_phone: h.emergency_phone ?? "",
  });

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const missing = useMemo(() => {
    const required: [keyof typeof form, string][] = [
      ["legal_first_name", "first name"],
      ["legal_last_name", "last name"],
      ["date_of_birth", "date of birth"],
      ["mobile", "mobile"],
      ["address_line1", "street address"],
      ["suburb", "suburb"],
      ["postcode", "postcode"],
      ["emergency_name", "emergency contact name"],
      ["emergency_phone", "emergency contact phone"],
    ];
    return required.filter(([k]) => !form[k].trim()).map(([, label]) => label);
  }, [form]);

  const save = async () => {
    if (missing.length) {
      toast.error(`Still needed: ${missing.join(", ")}`);
      return;
    }
    try {
      await saveDetails.mutateAsync({ patch: form, step: 2 });
      onNext();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save your details");
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Your legal name and date of birth go to payroll, so they need to match your ID.
      </p>

      <Card title="About you">
        <Field label="Legal first name" value={form.legal_first_name} onChange={set("legal_first_name")} autoComplete="given-name" />
        <Field label="Legal last name" value={form.legal_last_name} onChange={set("legal_last_name")} autoComplete="family-name" />
        <Field
          label="What should we call you? (optional)"
          value={form.preferred_name}
          onChange={set("preferred_name")}
          placeholder="If it's different"
        />
        <Field label="Date of birth" type="date" value={form.date_of_birth} onChange={set("date_of_birth")} />
        <Field label="Mobile" type="tel" value={form.mobile} onChange={set("mobile")} autoComplete="tel" />
        <Field
          label="Email (optional)"
          type="email"
          value={form.email}
          onChange={set("email")}
          autoComplete="email"
          hint="Only used if we need to reach you — you don't need one to work here."
        />
      </Card>

      <Card title="Where you live">
        <Field label="Street address" value={form.address_line1} onChange={set("address_line1")} autoComplete="address-line1" />
        <Field
          label="Unit / level (optional)"
          value={form.address_line2}
          onChange={set("address_line2")}
          autoComplete="address-line2"
        />
        <Field label="Suburb" value={form.suburb} onChange={set("suburb")} autoComplete="address-level2" />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="state">State</Label>
            <select
              id="state"
              className="h-11 w-full rounded-lg border border-border-strong bg-card px-3 text-base"
              value={form.address_state}
              onChange={(e) => set("address_state")(e.target.value)}
            >
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <Field
            label="Postcode"
            value={form.postcode}
            onChange={set("postcode")}
            inputMode="numeric"
            autoComplete="postal-code"
          />
        </div>
      </Card>

      <Card title="Who we call in an emergency">
        <Field label="Their name" value={form.emergency_name} onChange={set("emergency_name")} />
        <Field
          label="How you know them (optional)"
          value={form.emergency_relationship}
          onChange={set("emergency_relationship")}
          placeholder="Partner, parent, friend…"
        />
        <Field label="Their phone" type="tel" value={form.emergency_phone} onChange={set("emergency_phone")} />
      </Card>

      <StepNav onNext={save} busy={saveDetails.isPending} nextLabel="Save and continue" />
    </div>
  );
}

// ── Step 2: certificates ────────────────────────────────────────────────────

function CertificatesStep({
  token,
  data,
  onBack,
  onNext,
}: {
  token: string;
  data: NewHireIntake;
  onBack: () => void;
  onNext: () => void;
}) {
  const { addCertificate, removeCertificate } = useNewHireIntakeActions(token);
  const reqs = data.certificate_requirements;
  const [kind, setKind] = useState(reqs[0]?.kind ?? "other");
  const [label, setLabel] = useState("");
  const [expires, setExpires] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const requiredKinds = reqs.filter((r) => r.required).map((r) => r.kind);
  const haveKinds = new Set(data.certificates.map((c) => c.kind));
  const missingRequired = requiredKinds.filter((k) => !haveKinds.has(k));
  const selectedReq = reqs.find((r) => r.kind === kind);

  const add = async () => {
    if (!file && !label.trim()) {
      toast.error("Attach a photo, or at least name the certificate.");
      return;
    }
    if (selectedReq?.needs_expiry && !expires) {
      toast.error("Add the expiry date so we can remind you before it runs out.");
      return;
    }
    try {
      await addCertificate.mutateAsync({
        kind,
        label: label.trim() || selectedReq?.label,
        file,
        expiresOn: expires || null,
      });
      setLabel("");
      setExpires("");
      setFile(null);
      toast.success("Added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add that certificate");
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        A photo from your phone is fine. We'll remind you a month before anything runs out.
      </p>

      {data.certificates.length > 0 && (
        <Card title="Added">
          <ul className="divide-y divide-border">
            {data.certificates.map((c) => (
              <li key={c.id} className="flex items-center gap-2.5 py-2 text-sm">
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {c.label || c.kind}
                  {c.expires_on && (
                    <span className="ml-1.5 text-[12px] text-muted-foreground">
                      to {format(new Date(c.expires_on), "d MMM yy")}
                    </span>
                  )}
                </span>
                <button
                  onClick={() => void removeCertificate.mutateAsync(c.id)}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${c.label || c.kind}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Add a certificate">
        <div className="space-y-1.5">
          <Label htmlFor="cert-kind">What is it?</Label>
          <select
            id="cert-kind"
            className="h-11 w-full rounded-lg border border-border-strong bg-card px-3 text-base"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {reqs.map((r) => (
              <option key={r.kind} value={r.kind}>
                {r.label}
                {r.required ? " (needed)" : ""}
              </option>
            ))}
            <option value="other">Something else</option>
          </select>
        </div>

        {kind === "other" && (
          <Field label="Name it" value={label} onChange={setLabel} placeholder="e.g. Forklift licence" />
        )}

        <Field
          label={selectedReq?.needs_expiry ? "Expiry date" : "Expiry date (if it has one)"}
          type="date"
          value={expires}
          onChange={setExpires}
        />

        <div className="space-y-1.5">
          <Label htmlFor="cert-file">Photo or PDF</Label>
          <label
            htmlFor="cert-file"
            className="flex min-h-[52px] cursor-pointer items-center gap-2.5 rounded-lg border border-dashed border-border-strong bg-card px-3 py-3 text-sm text-muted-foreground hover:bg-accent"
          >
            <Upload className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {file ? file.name : "Take a photo or choose a file"}
            </span>
          </label>
          <input
            id="cert-file"
            type="file"
            accept="image/*,application/pdf"
            className="sr-only"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <Button className="w-full" variant="outline" onClick={add} disabled={addCertificate.isPending}>
          {addCertificate.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Add it
        </Button>
      </Card>

      {missingRequired.length > 0 && (
        <p className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-[13px] text-warning">
          Still needed:{" "}
          {missingRequired.map((k) => reqs.find((r) => r.kind === k)?.label ?? k).join(", ")}.
        </p>
      )}

      <StepNav onBack={onBack} onNext={onNext} nextDisabled={missingRequired.length > 0} />
    </div>
  );
}

// ── Step 3: policies ────────────────────────────────────────────────────────

function PoliciesStep({
  token,
  data,
  onBack,
  onNext,
}: {
  token: string;
  data: NewHireIntake;
  onBack: () => void;
  onNext: () => void;
}) {
  const { signPolicy } = useNewHireIntakeActions(token);
  const fullName = [data.hire.legal_first_name, data.hire.legal_last_name]
    .filter(Boolean)
    .join(" ");
  const [open, setOpen] = useState<string | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [ticked, setTicked] = useState<Record<string, boolean>>({});

  const outstanding = data.policies.filter((p) => p.required && !p.signed_at);

  if (data.policies.length === 0) {
    return (
      <div className="space-y-5">
        <Card title="Nothing to sign">
          <p className="text-sm text-muted-foreground">
            This brand hasn't added any policy documents yet, so there's nothing for you here.
          </p>
        </Card>
        <StepNav onBack={onBack} onNext={onNext} />
      </div>
    );
  }

  const sign = async (id: string) => {
    const name = (typed[id] ?? "").trim();
    if (!ticked[id]) return toast.error("Tick the box to say you've read it.");
    if (name.length < 3) return toast.error("Type your full name to sign.");
    try {
      await signPolicy.mutateAsync({ documentId: id, typedName: name });
      setOpen(null);
      toast.success("Signed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't record your signature");
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Read each one, tick the box and type your name. That's your signature, and it's
        timestamped.
      </p>

      <div className="space-y-3">
        {data.policies.map((p) => {
          const signed = !!p.signed_at;
          const isOpen = open === p.id;
          return (
            <div
              key={p.id}
              className={cn(
                "rounded-xl border bg-card",
                signed ? "border-success/40" : "border-border"
              )}
            >
              <button
                onClick={() => setOpen(isOpen ? null : p.id)}
                className="flex w-full items-center gap-2.5 px-4 py-3.5 text-left"
              >
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                    signed ? "bg-success-soft text-success" : "bg-surface-sunken text-muted-foreground"
                  )}
                >
                  {signed ? <Check className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-foreground">{p.title}</span>
                  <span className="block text-[13px] text-muted-foreground">
                    {signed
                      ? `Signed “${p.typed_name}”`
                      : p.required
                      ? "Needs your signature"
                      : "Optional"}
                  </span>
                </span>
              </button>

              {isOpen && (
                <div className="space-y-3 border-t border-border px-4 py-3.5">
                  {p.body && (
                    <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-subtle p-3 text-[13px] leading-relaxed text-foreground">
                      {p.body}
                    </div>
                  )}
                  {p.url && (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                    >
                      Open the full document
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}

                  {signed ? (
                    <p className="text-[13px] text-success">
                      Signed on {format(new Date(p.signed_at!), "d MMMM yyyy 'at' HH:mm")}.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                        <Checkbox
                          className="mt-0.5"
                          checked={!!ticked[p.id]}
                          onCheckedChange={(c) =>
                            setTicked((t) => ({ ...t, [p.id]: c === true }))
                          }
                        />
                        <span className="text-foreground">
                          I've read and understood this policy.
                        </span>
                      </label>
                      <Field
                        label="Type your full name"
                        value={typed[p.id] ?? fullName}
                        onChange={(v) => setTyped((t) => ({ ...t, [p.id]: v }))}
                        autoComplete="name"
                      />
                      <Button
                        className="w-full"
                        onClick={() => void sign(p.id)}
                        disabled={signPolicy.isPending}
                      >
                        {signPolicy.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                        Sign
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <StepNav onBack={onBack} onNext={onNext} nextDisabled={outstanding.length > 0} />
    </div>
  );
}

// ── Step 4: payroll (link out — nothing sensitive stored here) ──────────────

function PayrollStep({
  token,
  data,
  onBack,
  onNext,
}: {
  token: string;
  data: NewHireIntake;
  onBack: () => void;
  onNext: () => void;
}) {
  const { confirmPayroll } = useNewHireIntakeActions(token);
  const url = data.brand?.payroll_onboarding_url;
  const [confirmed, setConfirmed] = useState(data.hire.payroll_confirmed);

  const confirm = async () => {
    try {
      await confirmPayroll.mutateAsync();
      setConfirmed(true);
      toast.success("Noted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't record that");
    }
  };

  return (
    <div className="space-y-5">
      <Card title="Tax, super and bank details">
        <div className="flex items-start gap-2.5 rounded-lg bg-surface-subtle p-3">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-[13px] text-muted-foreground">
            ORBIT doesn't ask for your tax file number or bank details, and doesn't store them.
            Those go straight to payroll.
          </p>
        </div>

        {url ? (
          <>
            <p className="text-sm text-foreground">
              Open payroll onboarding, fill it in there, then come back and tick the box.
            </p>
            <Button className="w-full" size="lg" asChild>
              <a href={url} target="_blank" rel="noreferrer">
                Open payroll onboarding
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </>
        ) : (
          <p className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-[13px] text-warning">
            Your workplace hasn't set up a payroll link yet. Ask your manager how they'd like
            you to do this part, then tick the box below once it's sorted.
          </p>
        )}

        {confirmed ? (
          <p className="inline-flex items-center gap-1.5 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" />
            You've confirmed this is done.
          </p>
        ) : (
          <Button
            variant="outline"
            className="w-full"
            onClick={confirm}
            disabled={confirmPayroll.isPending}
          >
            {confirmPayroll.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            I've completed this
          </Button>
        )}
      </Card>

      <StepNav onBack={onBack} onNext={onNext} nextDisabled={!confirmed} />
    </div>
  );
}

// ── Step 5: finish ──────────────────────────────────────────────────────────

function FinishStep({
  token,
  data,
  onBack,
}: {
  token: string;
  data: NewHireIntake;
  onBack: () => void;
}) {
  const { submit } = useNewHireIntakeActions(token);
  const h = data.hire;

  const checks = [
    { label: "Your details", done: h.details_complete },
    { label: "Certificates", done: h.certificates_complete },
    { label: "Policy sign-offs", done: h.policies_complete },
    { label: "Payroll", done: h.payroll_confirmed },
  ];
  const ready = checks.every((c) => c.done);

  const send = async () => {
    try {
      const res = await submit.mutateAsync();
      if (!res.ok) {
        toast.error(`Still to do: ${(res.missing ?? []).join(", ")}`);
        return;
      }
      // The page re-reads itself and lands on the "all done" screen.
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send your form");
    }
  };

  return (
    <div className="space-y-5">
      <Card title="Ready to send?">
        <ul className="space-y-2">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center gap-2.5 text-sm">
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                  c.done ? "bg-success-soft text-success" : "bg-surface-sunken text-muted-foreground"
                )}
              >
                {c.done ? <Check className="h-3 w-3" /> : <span className="text-[10px]">•</span>}
              </span>
              <span className={c.done ? "text-foreground" : "text-muted-foreground"}>
                {c.label}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[13px] text-muted-foreground">
          Once you send this you can't change it from the link. Your manager can fix anything
          that's wrong.
        </p>
      </Card>

      <div className="flex gap-2">
        <Button variant="outline" size="lg" className="flex-1" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button size="lg" className="flex-1" onClick={send} disabled={!ready || submit.isPending}>
          {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Send it
        </Button>
      </div>
    </div>
  );
}

// ── Small pieces ────────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3.5 rounded-xl border border-border bg-card p-4">
      <h2 className="font-display text-base font-semibold text-card-foreground">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Inputs here are 44px tall rather than the app's usual 36px. This form is
 * filled in on a phone, often standing up, and the app's density is wrong for
 * that.
 */
function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  hint,
  inputMode,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
  inputMode?: "numeric" | "tel" | "text" | "email";
  autoComplete?: string;
}) {
  const id = label.toLowerCase().replace(/[^a-z]+/g, "-");
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 text-base"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
