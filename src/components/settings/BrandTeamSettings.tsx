import { useState } from "react";
import {
  ClipboardList,
  ExternalLink,
  FileText,
  GraduationCap,
  HeartPulse,
  Loader2,
  MessageSquareHeart,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  useCertificateRequirements,
  useExitChecklistTemplate,
  useExitQuestions,
  useOnboardingChecklistTemplate,
  usePolicyDocuments,
  useSavePayrollUrl,
  useTeamTemplateActions,
  useTrainingModules,
  type TeamTemplateTable,
} from "@/hooks/useTeamTemplates";
import {
  usePulseQuestionActions,
  usePulseQuestions,
} from "@/hooks/usePulseSurveys";
import { EmptyState, LoadingRows } from "@/components/team/TeamUI";
import { cn } from "@/lib/utils";
import type { Brand } from "@/types";

// ============================================================================
// SETTINGS → BRANDS → TEAM
// ----------------------------------------------------------------------------
// Everything configurable about the three Team modules, for one brand, in one
// dialog: the Pulse question bank, policy documents, the two checklists, which
// certificates are asked for, the training list, the exit questions, and the
// payroll URL.
//
// It all lives here rather than in a Settings section of its own because these
// are brand properties — two brands in the same ORBIT have different policies
// and different payroll providers, and a single global list would be wrong for
// both.
// ============================================================================

type Section =
  | "questions"
  | "policies"
  | "checklist"
  | "certificates"
  | "training"
  | "exit"
  | "payroll";

const SECTIONS: { key: Section; label: string; icon: typeof FileText }[] = [
  { key: "questions", label: "Pulse questions", icon: HeartPulse },
  { key: "policies", label: "Policy documents", icon: FileText },
  { key: "checklist", label: "Induction checklist", icon: ClipboardList },
  { key: "certificates", label: "Certificates", icon: ShieldCheck },
  { key: "training", label: "Training", icon: GraduationCap },
  { key: "exit", label: "Exit", icon: MessageSquareHeart },
  { key: "payroll", label: "Payroll link", icon: ExternalLink },
];

export function BrandTeamSettings({ brand, onClose }: { brand: Brand; onClose: () => void }) {
  const [section, setSection] = useState<Section>("questions");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{brand.name} — Team</DialogTitle>
        </DialogHeader>

        <div className="flex max-h-[calc(88vh-80px)] flex-col sm:flex-row">
          <nav className="shrink-0 border-b border-border p-2 sm:w-52 sm:border-b-0 sm:border-r">
            <div className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-visible">
              {SECTIONS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSection(s.key)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors sm:w-full",
                    section === s.key
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <s.icon className="h-4 w-4 shrink-0" />
                  {s.label}
                </button>
              ))}
            </div>
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto p-5">
            {section === "questions" && <PulseQuestionBank brandId={brand.id} />}
            {section === "policies" && <PolicyDocuments brandId={brand.id} />}
            {section === "checklist" && <InductionChecklist brandId={brand.id} />}
            {section === "certificates" && <Certificates brandId={brand.id} />}
            {section === "training" && <Training brandId={brand.id} />}
            {section === "exit" && <ExitSettings brandId={brand.id} />}
            {section === "payroll" && <PayrollLink brand={brand} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Shared list shell ───────────────────────────────────────────────────────

function SectionHead({
  title,
  blurb,
  onAdd,
}: {
  title: string;
  blurb: string;
  onAdd?: () => void;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h3 className="font-display text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{blurb}</p>
      </div>
      {onAdd && (
        <Button size="sm" onClick={onAdd} className="shrink-0">
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      )}
    </div>
  );
}

/** Rows share the same shape across every list: label, meta, on/off, delete. */
function TemplateRow({
  label,
  meta,
  isActive,
  onToggle,
  onEdit,
  onDelete,
}: {
  label: string;
  meta?: string;
  isActive: boolean;
  onToggle: (on: boolean) => void;
  onEdit?: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm", isActive ? "text-foreground" : "text-muted-foreground")}>
          {label}
        </p>
        {meta && <p className="truncate text-[12px] text-muted-foreground">{meta}</p>}
      </div>
      <Switch checked={isActive} onCheckedChange={onToggle} aria-label={`${label} on`} />
      {onEdit && (
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Edit ${label}`} onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        aria-label={`Delete ${label}`}
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function nextOrder(rows: { sort_order: number }[]) {
  return (rows.reduce((m, r) => Math.max(m, r.sort_order), 0) || 0) + 10;
}

// ── Pulse question bank ─────────────────────────────────────────────────────

function PulseQuestionBank({ brandId }: { brandId: string }) {
  const { data: questions = [], isLoading } = usePulseQuestions(brandId);
  const { create, save, reorder, remove } = usePulseQuestionActions();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [type, setType] = useState<"scale_1_5" | "text">("scale_1_5");
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const add = async () => {
    if (!text.trim()) return toast.error("Type the question");
    try {
      await create.mutateAsync({ brandId, text, type, sortOrder: nextOrder(questions) });
      setText("");
      setAdding(false);
      toast.success("Question added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add it");
    }
  };

  const saveEdit = async (id: string) => {
    if (!editText.trim()) return toast.error("Type the question");
    try {
      const res = await save.mutateAsync({ id, text: editText });
      setEditId(null);
      toast.success(
        res.versioned
          ? "Saved as a new version — the old wording stays on answers already given"
          : "Question updated"
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save it");
    }
  };

  const move = async (id: string, dir: -1 | 1) => {
    const ordered = questions.slice().sort((a, b) => a.sort_order - b.sort_order);
    const i = ordered.findIndex((q) => q.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    await reorder.mutateAsync(ordered.map((q, k) => ({ id: q.id, sort_order: (k + 1) * 10 })));
  };

  return (
    <div>
      <SectionHead
        title="Pulse questions"
        blurb="This brand's question bank. Every check-in picks from it. Editing wording that already has answers creates a new version instead of rewriting history."
        onAdd={() => setAdding(true)}
      />

      {isLoading ? (
        <LoadingRows rows={5} />
      ) : questions.length === 0 ? (
        <EmptyState
          icon={HeartPulse}
          title="No questions yet"
          hint="Six starters are seeded when a brand is created. If they're gone, add your own."
        />
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border px-3">
          {questions
            .slice()
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((q, i, arr) => (
              <div key={q.id} className="py-2.5">
                {editId === q.id ? (
                  <div className="space-y-2">
                    <Textarea
                      rows={2}
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => void saveEdit(q.id)} disabled={save.isPending}>
                        {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="flex shrink-0 flex-col">
                      <button
                        aria-label="Move up"
                        disabled={i === 0}
                        onClick={() => void move(q.id, -1)}
                        className="text-xs leading-none text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        aria-label="Move down"
                        disabled={i === arr.length - 1}
                        onClick={() => void move(q.id, 1)}
                        className="text-xs leading-none text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        ↓
                      </button>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-sm",
                          q.is_active ? "text-foreground" : "text-muted-foreground line-through"
                        )}
                      >
                        {q.text}
                      </p>
                      <p className="text-[12px] text-muted-foreground">
                        {q.type === "text" ? "Free comment" : "Scored 1–5"}
                        {q.version > 1 && ` · version ${q.version}`}
                      </p>
                    </div>
                    <Switch
                      checked={q.is_active}
                      aria-label={`${q.text} on`}
                      onCheckedChange={(on) =>
                        void save.mutateAsync({ id: q.id, text: q.text, isActive: on })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label="Edit question"
                      onClick={() => {
                        setEditId(q.id);
                        setEditText(q.text);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      aria-label="Delete question"
                      onClick={async () => {
                        if (
                          !confirm(
                            "Delete this question? Any answers given to it are deleted too. Switching it off keeps the history."
                          )
                        )
                          return;
                        try {
                          await remove.mutateAsync(q.id);
                          toast.success("Deleted");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Couldn't delete it");
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
        </div>
      )}

      {adding && (
        <div className="mt-3 space-y-3 rounded-lg border border-border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-q">Question</Label>
            <Textarea
              id="new-q"
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="How was your week at work?"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-q-type">Answer</Label>
            <select
              id="new-q-type"
              className="h-9 w-full rounded-lg border border-border-strong bg-card px-3 text-sm"
              value={type}
              onChange={(e) => setType(e.target.value as "scale_1_5" | "text")}
            >
              <option value="scale_1_5">1–5 with faces</option>
              <option value="text">Free comment (optional to answer)</option>
            </select>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={add} disabled={create.isPending}>
              {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Add question
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Policy documents ────────────────────────────────────────────────────────

function PolicyDocuments({ brandId }: { brandId: string }) {
  const { data: docs = [], isLoading } = usePolicyDocuments(brandId);
  const { create, update, remove } = useTeamTemplateActions("brand_policy_documents");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState({ title: "", body: "", url: "", required: true });

  const open = (id: string | "new") => {
    if (id === "new") {
      setForm({ title: "", body: "", url: "", required: true });
    } else {
      const d = docs.find((x) => x.id === id);
      setForm({
        title: d?.title ?? "",
        body: d?.body ?? "",
        url: d?.url ?? "",
        required: d?.required ?? true,
      });
    }
    setEditing(id);
  };

  const save = async () => {
    if (!form.title.trim()) return toast.error("Give the document a title");
    if (!form.body.trim() && !form.url.trim()) {
      return toast.error("Paste the policy text, or link to it — otherwise there's nothing to read.");
    }
    try {
      if (editing === "new") {
        await create.mutateAsync({
          brand_id: brandId,
          title: form.title.trim(),
          body: form.body.trim() || null,
          url: form.url.trim() || null,
          required: form.required,
          sort_order: nextOrder(docs),
        });
      } else if (editing) {
        const current = docs.find((d) => d.id === editing);
        const bodyChanged =
          (current?.body ?? "") !== form.body.trim() || (current?.url ?? "") !== form.url.trim();
        await update.mutateAsync({
          id: editing,
          patch: {
            title: form.title.trim(),
            body: form.body.trim() || null,
            url: form.url.trim() || null,
            required: form.required,
            // Changing what people are agreeing to is a new version. Sign-offs
            // already given keep the version number they signed against.
            ...(bodyChanged ? { version: (current?.version ?? 1) + 1 } : {}),
          },
        });
      }
      setEditing(null);
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save it");
    }
  };

  return (
    <div>
      <SectionHead
        title="Policy documents"
        blurb="New hires tick a box and type their name against each of these. Editing the text bumps the version, so old sign-offs still say what was actually agreed."
        onAdd={() => open("new")}
      />

      {isLoading ? (
        <LoadingRows rows={3} />
      ) : docs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No policies yet"
          hint="Add the ones you'd normally hand over on paper — code of conduct, food safety, phone use."
        />
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border px-3">
          {docs.map((d) => (
            <TemplateRow
              key={d.id}
              label={d.title}
              meta={`v${d.version} · ${d.required ? "must sign" : "optional"}${d.url ? " · linked" : ""}`}
              isActive={d.is_active}
              onToggle={(on) => update.mutate({ id: d.id, patch: { is_active: on } })}
              onEdit={() => open(d.id)}
              onDelete={() => {
                if (!confirm(`Delete "${d.title}"? Sign-offs keep a copy of its title and version.`))
                  return;
                remove.mutate(d.id);
              }}
            />
          ))}
        </div>
      )}

      {editing && (
        <div className="mt-3 space-y-3 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">
              {editing === "new" ? "New policy" : "Edit policy"}
            </p>
            <button
              onClick={() => setEditing(null)}
              aria-label="Close"
              className="rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pol-title">Title</Label>
            <Input
              id="pol-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Code of conduct"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pol-body">Text shown to the hire</Label>
            <Textarea
              id="pol-body"
              rows={6}
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              placeholder="Paste the policy here."
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pol-url">Or a link (optional)</Label>
            <Input
              id="pol-url"
              type="url"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://…"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <Checkbox
              checked={form.required}
              onCheckedChange={(c) => setForm((f) => ({ ...f, required: c === true }))}
            />
            <span className="text-foreground">Must be signed before they can be rostered</span>
          </label>
          <Button size="sm" onClick={save} disabled={create.isPending || update.isPending}>
            {(create.isPending || update.isPending) && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            Save
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Simple label lists (induction + exit checklists) ────────────────────────

function LabelList({
  brandId,
  table,
  rows,
  isLoading,
  title,
  blurb,
  icon,
  placeholder,
}: {
  brandId: string;
  table: TeamTemplateTable;
  rows: { id: string; label: string; description: string | null; sort_order: number; is_active: boolean }[];
  isLoading: boolean;
  title: string;
  blurb: string;
  icon: typeof ClipboardList;
  placeholder: string;
}) {
  const { create, update, remove } = useTeamTemplateActions(table);
  const [label, setLabel] = useState("");

  const add = async () => {
    if (!label.trim()) return;
    try {
      await create.mutateAsync({
        brand_id: brandId,
        label: label.trim(),
        sort_order: nextOrder(rows),
      });
      setLabel("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add it");
    }
  };

  return (
    <div>
      <SectionHead title={title} blurb={blurb} />

      {isLoading ? (
        <LoadingRows rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState icon={icon} title="Nothing on the list" hint={placeholder} />
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border px-3">
          {rows.map((r) => (
            <TemplateRow
              key={r.id}
              label={r.label}
              meta={r.description ?? undefined}
              isActive={r.is_active}
              onToggle={(on) => update.mutate({ id: r.id, patch: { is_active: on } })}
              onDelete={() => {
                if (!confirm(`Delete "${r.label}"?`)) return;
                remove.mutate(r.id);
              }}
            />
          ))}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          placeholder={placeholder}
        />
        <Button variant="outline" onClick={add} disabled={create.isPending} className="shrink-0">
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>
    </div>
  );
}

function InductionChecklist({ brandId }: { brandId: string }) {
  const { data: rows = [], isLoading } = useOnboardingChecklistTemplate(brandId);
  return (
    <LabelList
      brandId={brandId}
      table="brand_onboarding_checklist_items"
      rows={rows}
      isLoading={isLoading}
      title="Induction checklist"
      blurb="The manager's half of getting someone ready. Every active item has to be ticked before a new hire can go on the roster."
      icon={ClipboardList}
      placeholder="e.g. Uniform issued"
    />
  );
}

// ── Certificates ────────────────────────────────────────────────────────────

function Certificates({ brandId }: { brandId: string }) {
  const { data: rows = [], isLoading } = useCertificateRequirements(brandId);
  const { create, update, remove } = useTeamTemplateActions("brand_certificate_requirements");
  const [label, setLabel] = useState("");

  const add = async () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const kind = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
    try {
      await create.mutateAsync({
        brand_id: brandId,
        kind,
        label: trimmed,
        required: false,
        needs_expiry: true,
        sort_order: nextOrder(rows),
      });
      setLabel("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add it");
    }
  };

  return (
    <div>
      <SectionHead
        title="Certificates"
        blurb="What new hires are asked to upload. Marking one as required blocks rostering until it's there — so only tick that for the ones you'd actually send someone home over."
      />

      {isLoading ? (
        <LoadingRows rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="Nothing asked for"
          hint="Add the tickets your venues care about — RSA, food handler, licences."
        />
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border px-3">
          {rows.map((r) => (
            <div key={r.id} className="space-y-2 py-3">
              <div className="flex items-center gap-3">
                <p
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm",
                    r.is_active ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {r.label}
                </p>
                <Switch
                  checked={r.is_active}
                  aria-label={`${r.label} on`}
                  onCheckedChange={(on) => update.mutate({ id: r.id, patch: { is_active: on } })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  aria-label={`Delete ${r.label}`}
                  onClick={() => {
                    if (!confirm(`Delete "${r.label}"?`)) return;
                    remove.mutate(r.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-4 pl-0 text-[13px]">
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={r.required}
                    onCheckedChange={(c) =>
                      update.mutate({ id: r.id, patch: { required: c === true } })
                    }
                  />
                  <span className="text-muted-foreground">Required</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={r.needs_expiry}
                    onCheckedChange={(c) =>
                      update.mutate({ id: r.id, patch: { needs_expiry: c === true } })
                    }
                  />
                  <span className="text-muted-foreground">Has an expiry date</span>
                </label>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          placeholder="e.g. Forklift licence"
        />
        <Button variant="outline" onClick={add} disabled={create.isPending} className="shrink-0">
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>
    </div>
  );
}

// ── Training ────────────────────────────────────────────────────────────────

function Training({ brandId }: { brandId: string }) {
  const { data: rows = [], isLoading } = useTrainingModules(brandId);
  const { create, update, remove } = useTeamTemplateActions("brand_training_modules");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  const add = async () => {
    if (!name.trim()) return;
    try {
      await create.mutateAsync({
        brand_id: brandId,
        name: name.trim(),
        url: url.trim() || null,
        required: true,
        sort_order: nextOrder(rows),
      });
      setName("");
      setUrl("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add it");
    }
  };

  return (
    <div>
      <SectionHead
        title="Training"
        blurb="Assigned automatically when a new hire submits their form."
      />

      <p className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-surface-subtle p-3 text-[13px] text-muted-foreground">
        <GraduationCap className="mt-0.5 h-4 w-4 shrink-0" />
        ORBIT has no training platform. This is a named list with optional links, ticked off by
        hand — a placeholder until there's something real to plug in.
      </p>

      {isLoading ? (
        <LoadingRows rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState icon={GraduationCap} title="No modules" hint="Add what every new hire has to get through." />
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border px-3">
          {rows.map((m) => (
            <TemplateRow
              key={m.id}
              label={m.name}
              meta={m.url ?? (m.required ? "required" : "optional")}
              isActive={m.is_active}
              onToggle={(on) => update.mutate({ id: m.id, patch: { is_active: on } })}
              onDelete={() => {
                if (!confirm(`Delete "${m.name}"?`)) return;
                remove.mutate(m.id);
              }}
            />
          ))}
        </div>
      )}

      <div className="mt-3 space-y-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Module name" />
        <div className="flex gap-2">
          <Input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Link (optional)"
          />
          <Button variant="outline" onClick={add} disabled={create.isPending} className="shrink-0">
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Exit: checklist + questions ─────────────────────────────────────────────

function ExitSettings({ brandId }: { brandId: string }) {
  const { data: checklist = [], isLoading: clLoading } = useExitChecklistTemplate(brandId);
  const { data: questions = [], isLoading: qLoading } = useExitQuestions(brandId);
  const { create: createQ, update: updateQ, remove: removeQ } =
    useTeamTemplateActions("brand_exit_questions");
  const [qText, setQText] = useState("");
  const [qType, setQType] = useState<"scale_1_5" | "text">("scale_1_5");

  const addQ = async () => {
    if (!qText.trim()) return;
    try {
      await createQ.mutateAsync({
        brand_id: brandId,
        text: qText.trim(),
        type: qType,
        sort_order: nextOrder(questions),
      });
      setQText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add it");
    }
  };

  return (
    <div className="space-y-8">
      <LabelList
        brandId={brandId}
        table="brand_exit_checklist_items"
        rows={checklist}
        isLoading={clLoading}
        title="Exit checklist"
        blurb="What the manager works through when someone leaves."
        icon={ClipboardList}
        placeholder="e.g. Uniform returned"
      />

      <div>
        <SectionHead
          title="Exit questions"
          blurb="Asked on their next login, before access ends. These answers are NOT anonymous — the leaver's name is attached and only brand admins can read them."
        />

        {qLoading ? (
          <LoadingRows rows={3} />
        ) : questions.length === 0 ? (
          <EmptyState
            icon={MessageSquareHeart}
            title="No exit questions"
            hint="Three is about the limit for someone on their way out."
          />
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border px-3">
            {questions.map((q) => (
              <TemplateRow
                key={q.id}
                label={q.text}
                meta={q.type === "text" ? "Free comment" : "Scored 1–5"}
                isActive={q.is_active}
                onToggle={(on) => updateQ.mutate({ id: q.id, patch: { is_active: on } })}
                onDelete={() => {
                  if (!confirm("Delete this question? Answers already given go with it.")) return;
                  removeQ.mutate(q.id);
                }}
              />
            ))}
          </div>
        )}

        <div className="mt-3 space-y-2">
          <Input
            value={qText}
            onChange={(e) => setQText(e.target.value)}
            placeholder="Why are you leaving?"
          />
          <div className="flex gap-2">
            <select
              aria-label="Answer type"
              className="h-9 min-w-0 flex-1 rounded-lg border border-border-strong bg-card px-3 text-sm"
              value={qType}
              onChange={(e) => setQType(e.target.value as "scale_1_5" | "text")}
            >
              <option value="scale_1_5">1–5 with faces</option>
              <option value="text">Free comment</option>
            </select>
            <Button variant="outline" onClick={addQ} disabled={createQ.isPending} className="shrink-0">
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Payroll link ────────────────────────────────────────────────────────────

function PayrollLink({ brand }: { brand: Brand }) {
  const savePayroll = useSavePayrollUrl();
  const [url, setUrl] = useState(brand.payroll_onboarding_url ?? "");

  return (
    <div>
      <SectionHead
        title="Payroll link"
        blurb="Where new hires go to hand over tax, super and bank details."
      />

      <p className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-surface-subtle p-3 text-[13px] text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        ORBIT never asks for, and never stores, a tax file number or bank details. The onboarding
        form links out to this URL and records only that the hire says they've done it.
      </p>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="payroll-url">Payroll onboarding URL</Label>
          <Input
            id="payroll-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://payroll.example.com/onboarding"
          />
          <p className="text-xs text-muted-foreground">
            Leave it blank and the hire is told to ask their manager instead.
          </p>
        </div>
        <Button
          size="sm"
          onClick={async () => {
            try {
              await savePayroll.mutateAsync({ brandId: brand.id, url });
              toast.success("Saved");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Couldn't save it");
            }
          }}
          disabled={savePayroll.isPending}
        >
          {savePayroll.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  );
}
