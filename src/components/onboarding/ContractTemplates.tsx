import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileSignature, Plus, Loader2, Save, Trash2, Eye, Code, ClipboardPaste,
  AlertTriangle, Sparkles, Building2, ShieldAlert, History,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useRestaurants } from "@/hooks/useRestaurants";
import { usePermissions } from "@/hooks/usePermissions";
import { useContractTemplates, useTemplateActions, useTemplateVersions } from "@/hooks/useContractTemplates";
import { useCompanySettings, useSaveCompanySettings } from "@/hooks/useOnboarding";
import {
  TOKENS, renderTemplate, sampleTokenValues, cleanPastedHtml, signatureBlockHtml,
  CONTRACT_CSS, printContract,
} from "@/lib/contract";
import { Field, TextInput, SelectInput } from "./fields";
import type { ContractTemplate, CompanySettings } from "@/types";

export default function ContractTemplates() {
  const { isSuperadmin } = usePermissions();
  const { data: templates, isLoading } = useContractTemplates();
  const { create, seed } = useTemplateActions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCompany, setShowCompany] = useState(false);

  const selected = templates?.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId && templates?.length) setSelectedId(templates[0].id);
  }, [templates, selectedId]);

  if (!isSuperadmin) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">
          Contract templates are managed by a superadmin.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Templates are matched by employment type and store — the most specific match wins.
        </p>
        <button
          onClick={() => setShowCompany((s) => !s)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm"
        >
          <Building2 className="h-4 w-4" />
          Company & signature
        </button>
      </div>

      {showCompany && <CompanyPanel onClose={() => setShowCompany(false)} />}

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !templates?.length ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center">
          <FileSignature className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">No contract templates yet.</p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              onClick={async () => {
                try { await seed.mutateAsync(); toast.success("Starter templates created"); }
                catch (e) { toast.error((e as Error).message); }
              }}
              disabled={seed.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {seed.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Create starter templates
            </button>
            <button
              onClick={() => create.mutate({ name: "New template" })}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm"
            >
              <Plus className="h-4 w-4" /> Blank template
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <div className="space-y-1">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={cn(
                  "w-full rounded-md border px-3 py-2 text-left text-sm",
                  selectedId === t.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                )}
              >
                <span className="block font-medium text-foreground">{t.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {t.kind === "variation" ? "Variation" : t.employment_type ? EMP_LABEL[t.employment_type] : "Any type"}
                  {" · v"}{t.version}
                  {!t.active && " · inactive"}
                </span>
              </button>
            ))}
            <button
              onClick={() => create.mutate({ name: "New template" })}
              className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-4 w-4" /> New template
            </button>
          </div>

          {selected ? (
            <TemplateEditor key={selected.id} template={selected} onDeleted={() => setSelectedId(null)} />
          ) : (
            <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
              Pick a template.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const EMP_LABEL: Record<string, string> = {
  casual: "Casual",
  part_time: "Part-time",
  full_time: "Full-time",
};

// ── Editor ──────────────────────────────────────────────────────────────────

function TemplateEditor({ template, onDeleted }: { template: ContractTemplate; onDeleted: () => void }) {
  const { data: restaurants } = useRestaurants();
  const { save, remove } = useTemplateActions();
  const { data: versions } = useTemplateVersions(template.id);
  const [form, setForm] = useState(template);
  const [view, setView] = useState<"code" | "preview">("code");
  const [showPaste, setShowPaste] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setForm(template), [template]);

  const preview = useMemo(() => {
    const r = renderTemplate(form.body_html, sampleTokenValues(), {
      signatureHtml: signatureBlockHtml({
        employeeName: "Jenny Nguyen",
        employerName: "Norm Sharples",
        employerTitle: "Director",
      }),
    });
    return r;
  }, [form.body_html]);

  const insertToken = (token: string) => {
    const ta = bodyRef.current;
    const snippet = `{{${token}}}`;
    if (!ta) {
      setForm((f) => ({ ...f, body_html: f.body_html + snippet }));
      return;
    }
    const start = ta.selectionStart ?? form.body_html.length;
    const end = ta.selectionEnd ?? start;
    const next = form.body_html.slice(0, start) + snippet + form.body_html.slice(end);
    setForm((f) => ({ ...f, body_html: next }));
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + snippet.length;
    });
  };

  const onSave = async () => {
    try {
      await save.mutateAsync({
        template,
        patch: {
          name: form.name,
          kind: form.kind,
          employment_type: form.employment_type,
          restaurant_id: form.restaurant_id,
          active: form.active,
          body_html: form.body_html,
          notes: form.notes,
        },
      });
      toast.success(
        form.body_html !== template.body_html
          ? `Saved as v${template.version + 1}`
          : "Saved"
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      {template.is_seed_draft && (
        <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-foreground">
            <span className="font-medium">Unreviewed draft.</span> This is a placeholder written
            against MA000003 to get the flow working. Replace it with your own wording, or have it
            checked by an employment lawyer, before anyone signs it.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Template name" className="sm:col-span-2">
          <TextInput value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
        </Field>
        <Field label="Document type">
          <SelectInput
            value={form.kind}
            onChange={(v) => setForm((f) => ({ ...f, kind: v as ContractTemplate["kind"] }))}
            options={[
              { value: "contract", label: "Employment contract" },
              { value: "variation", label: "Variation letter" },
            ]}
          />
        </Field>
        <Field label="Applies to" hint="Leave blank to use for any employment type.">
          <SelectInput
            value={form.employment_type ?? ""}
            onChange={(v) => setForm((f) => ({ ...f, employment_type: (v || null) as ContractTemplate["employment_type"] }))}
            placeholder="Any employment type"
            options={[
              { value: "casual", label: "Casual" },
              { value: "part_time", label: "Part-time" },
              { value: "full_time", label: "Full-time" },
            ]}
          />
        </Field>
        <Field label="Store" hint="Leave blank to use at every venue.">
          <SelectInput
            value={form.restaurant_id ?? ""}
            onChange={(v) => setForm((f) => ({ ...f, restaurant_id: v || null }))}
            placeholder="All stores"
            options={(restaurants ?? []).map((r) => ({ value: r.id, label: r.name }))}
          />
        </Field>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              className="h-4 w-4"
            />
            Active
          </label>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <div className="inline-flex rounded-md border border-border p-0.5">
          <ToolTab active={view === "code"} onClick={() => setView("code")} icon={Code}>Edit</ToolTab>
          <ToolTab active={view === "preview"} onClick={() => setView("preview")} icon={Eye}>Preview</ToolTab>
        </div>
        <TokenPicker onPick={insertToken} />
        <button
          onClick={() => setShowPaste((s) => !s)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm"
        >
          <ClipboardPaste className="h-4 w-4" /> Paste from Word
        </button>
        <button
          onClick={() => { try { printContract(preview.html, form.name); } catch (e) { toast.error((e as Error).message); } }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm"
        >
          Print preview
        </button>
        {versions && versions.length > 0 && (
          <button
            onClick={() => setShowVersions((s) => !s)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm"
          >
            <History className="h-4 w-4" /> v{template.version} · {versions.length} earlier
          </button>
        )}
      </div>

      {showPaste && (
        <PasteBox
          onDone={(html) => {
            setForm((f) => ({ ...f, body_html: html }));
            setShowPaste(false);
            toast.success("Pasted — now swap the fixed details for tokens.");
          }}
        />
      )}

      {showVersions && versions && (
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {versions.map((v) => (
            <li key={v.id} className="flex items-center justify-between p-2.5">
              <span className="text-muted-foreground">
                v{v.version} · {format(new Date(v.created_at), "d MMM yyyy, h:mma")}
              </span>
              <button
                onClick={() => setForm((f) => ({ ...f, body_html: v.body_html }))}
                className="rounded-md border border-border px-2 py-1 text-xs"
              >
                Load into editor
              </button>
            </li>
          ))}
        </ul>
      )}

      {(preview.missing.length > 0 || preview.unknown.length > 0) && view === "preview" && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-foreground">
          {preview.unknown.length > 0 && (
            <p><span className="font-medium">Unknown tokens:</span> {preview.unknown.join(", ")} — these will print literally.</p>
          )}
        </div>
      )}

      {view === "code" ? (
        <textarea
          ref={bodyRef}
          value={form.body_html}
          onChange={(e) => setForm((f) => ({ ...f, body_html: e.target.value }))}
          spellCheck={false}
          className="h-[520px] w-full rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed"
          placeholder="<h1>Employment Agreement</h1>&#10;<p>Between {{company.legal_name}} and {{employee.legal_name}}…</p>"
        />
      ) : (
        <div className="max-h-[520px] overflow-y-auto rounded-md border border-border bg-white p-6">
          <style>{CONTRACT_CSS}</style>
          <div className="contract-doc" dangerouslySetInnerHTML={{ __html: preview.html }} />
        </div>
      )}

      {!form.body_html.includes("{{signature.block}}") && (
        <p className="text-xs text-warning">
          This template has no <code>{"{{signature.block}}"}</code> — the signature panel will be
          appended at the end when it is issued.
        </p>
      )}

      <div className="flex items-center justify-between border-t border-border pt-3">
        <button
          onClick={onSave}
          disabled={save.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </button>
        <button
          onClick={async () => {
            if (!confirm(`Delete "${template.name}"? Contracts already signed from it are unaffected.`)) return;
            await remove.mutateAsync(template.id);
            onDeleted();
            toast.success("Template deleted");
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" /> Delete
        </button>
      </div>
    </div>
  );
}

function ToolTab({
  active, onClick, icon: Icon, children,
}: {
  active: boolean; onClick: () => void; icon: typeof Code; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

function TokenPicker({ onPick }: { onPick: (token: string) => void }) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => {
    const g: Record<string, typeof TOKENS> = {};
    TOKENS.forEach((t) => { (g[t.group] ??= []).push(t); });
    return g;
  }, []);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm"
      >
        Insert field
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-20 mt-1 max-h-80 w-72 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
            {Object.entries(groups).map(([group, items]) => (
              <div key={group}>
                <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group}
                </p>
                {items.map((t) => (
                  <button
                    key={t.token}
                    onClick={() => { onPick(t.token); setOpen(false); }}
                    className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    <span className="text-foreground">{t.label}</span>
                    <span className="block font-mono text-[11px] text-muted-foreground">{`{{${t.token}}}`}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Word and Google Docs put real HTML on the clipboard, so pasting into a
 * contenteditable keeps the headings, bold, lists and tables — the same result
 * a .docx importer gives, with nothing extra to install.
 */
function PasteBox({ onDone }: { onDone: (html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState("");

  return (
    <div className="rounded-md border border-dashed border-border p-3">
      <p className="mb-2 text-sm text-muted-foreground">
        Open your contract in Word or Google Docs, select all, copy, then click the box below and
        paste. Formatting is kept; Word's styling junk is stripped.
      </p>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={() => setPreview(cleanPastedHtml(ref.current?.innerHTML ?? ""))}
        className="min-h-[120px] max-h-64 overflow-y-auto rounded-md border border-border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => onDone(preview)}
          disabled={!preview}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Use this
        </button>
        <span className="text-xs text-muted-foreground">
          {preview ? `${preview.length.toLocaleString()} characters of HTML` : "Nothing pasted yet"}
        </span>
      </div>
    </div>
  );
}

// ── Company / employer signature ────────────────────────────────────────────

function CompanyPanel({ onClose }: { onClose: () => void }) {
  const { data } = useCompanySettings();
  const save = useSaveCompanySettings();
  const [form, setForm] = useState<CompanySettings | null>(null);
  useEffect(() => { if (data) setForm(data); }, [data]);

  if (!form) return null;
  const set = (k: keyof CompanySettings, v: string) => setForm({ ...form, [k]: v });

  const onFile = (file: File | null) => {
    if (!file) return;
    if (file.size > 400_000) { toast.error("Signature image must be under 400 KB"); return; }
    const reader = new FileReader();
    reader.onload = () => set("signature_image", String(reader.result));
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <h4 className="text-sm font-semibold text-foreground">Company details & employer signature</h4>
      <p className="text-xs text-muted-foreground">
        These fill the <code>{"{{company.*}}"}</code> tokens and counter-sign every contract, so you
        never have to sign one by hand.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Legal entity name"><TextInput value={form.legal_name} onChange={(v) => set("legal_name", v)} /></Field>
        <Field label="Trading name"><TextInput value={form.trading_name} onChange={(v) => set("trading_name", v)} /></Field>
        <Field label="ABN"><TextInput value={form.abn} onChange={(v) => set("abn", v)} /></Field>
        <Field label="Registered address"><TextInput value={form.address} onChange={(v) => set("address", v)} /></Field>
        <Field label="Signatory name"><TextInput value={form.signatory_name} onChange={(v) => set("signatory_name", v)} /></Field>
        <Field label="Signatory title"><TextInput value={form.signatory_title} onChange={(v) => set("signatory_title", v)} /></Field>
        <Field label="Signature image" className="sm:col-span-2" hint="PNG with a transparent background works best. Under 400 KB.">
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm"
          />
        </Field>
      </div>
      {form.signature_image && (
        <div className="flex items-center gap-3">
          <img src={form.signature_image} alt="Employer signature" className="h-12 rounded border border-border bg-white p-1" />
          <button onClick={() => set("signature_image", "")} className="text-xs text-muted-foreground hover:text-destructive">
            Remove
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={async () => {
            try { await save.mutateAsync(form); toast.success("Saved"); onClose(); }
            catch (e) { toast.error((e as Error).message); }
          }}
          disabled={save.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </button>
        <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm">Close</button>
      </div>
    </div>
  );
}
