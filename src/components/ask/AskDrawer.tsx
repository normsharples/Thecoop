import { useEffect, useRef, useState } from "react";
import { Sparkles, X, ArrowUp, Loader2, RotateCcw, ChevronDown } from "lucide-react";
import { useAsk, type AskStep } from "@/hooks/useAsk";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useRestaurantScope } from "@/hooks/useRestaurantScope";
import { cn } from "@/lib/utils";
import { AskMarkdown } from "./AskMarkdown";

const SUGGESTIONS = [
  "What was the busiest day this month?",
  "How are we tracking against projection this week?",
  "Which hour of the day makes us the most money?",
  "Was labour under control last week?",
];

/** Human-readable summary of a tool call, for the "How I got this" line. */
function describeStep(step: AskStep): string {
  const label = step.tool.replace(/_/g, " ");
  const from = step.input?.from as string | undefined;
  const to = step.input?.to as string | undefined;
  const range = from && to ? (from === to ? from : `${from} → ${to}`) : null;
  if (step.error) return `${label} — failed: ${step.error}`;
  return `${label}${range ? ` · ${range}` : ""} · ${step.rows} row${step.rows === 1 ? "" : "s"}`;
}

function Steps({ steps }: { steps: AskStep[] }) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
        How I got this
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1 rounded-md bg-surface-sunken px-2.5 py-2">
          {steps.map((s, i) => (
            <li key={i} className="font-mono text-[11px] leading-relaxed text-muted-foreground">
              {describeStep(s)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AskDrawer({ page }: { page?: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const { messages, isThinking, send, reset } = useAsk(page);
  const { data: restaurants = [] } = useRestaurants();
  const { ids, isAll } = useRestaurantScope();
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scopeLabel = isAll
    ? "All venues"
    : restaurants.filter((r) => ids.includes(r.id)).map((r) => r.name).join(", ") || "All venues";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Escape closes; Cmd/Ctrl+K opens — the assistant is worth a shortcut.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) setOpen(false);
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function submit(text: string) {
    setDraft("");
    void send(text);
  }

  return (
    <>
      {/* Launcher — sits above the mobile nav bar, clear of it on desktop. */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Ask The Coop"
          className="fixed bottom-20 right-4 z-40 inline-flex h-12 items-center gap-2 rounded-full border border-primary-hover bg-primary px-4 text-sm font-medium text-primary-foreground shadow-lg transition-colors hover:bg-primary-hover lg:bottom-6 lg:right-6"
        >
          <Sparkles className="h-4 w-4" />
          Ask
        </button>
      )}

      {open && (
        <>
          {/* Scrim on small screens only — on desktop the panel sits beside the
              page so you can keep reading the report you are asking about. */}
          <div
            className="fixed inset-0 z-40 bg-foreground/20 lg:hidden"
            onClick={() => setOpen(false)}
          />

          <aside className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-card sm:w-[440px]">
            <header className="flex h-[60px] shrink-0 items-center gap-2 border-b border-border px-4">
              <Sparkles className="h-4 w-4 text-primary" />
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-display text-[17px] font-semibold text-foreground">
                  Ask The Coop
                </h2>
                <p className="truncate text-[11px] text-muted-foreground">{scopeLabel}</p>
              </div>
              {messages.length > 0 && (
                <button
                  onClick={reset}
                  aria-label="Start over"
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {messages.length === 0 && (
                <div className="pt-6">
                  <p className="text-sm text-muted-foreground">
                    Ask about sales, labour, hours or targets. I read the same data the
                    reports do, for the venues you have access to.
                  </p>
                  <div className="mt-4 space-y-1.5">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => submit(s)}
                        className="w-full rounded-lg border border-border bg-surface-subtle px-3 py-2 text-left text-sm text-foreground transition-colors hover:border-border-strong hover:bg-accent"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <p className="max-w-[85%] rounded-xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                      {m.content}
                    </p>
                  </div>
                ) : (
                  <div key={i}>
                    {m.error ? (
                      <div className="rounded-lg border border-destructive-border bg-destructive-soft px-3 py-2 text-sm text-destructive">
                        {m.content}
                      </div>
                    ) : (
                      <>
                        <AskMarkdown content={m.content} />
                        {m.steps && <Steps steps={m.steps} />}
                      </>
                    )}
                  </div>
                )
              )}

              {isThinking && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Looking through the data…
                </div>
              )}

              <div ref={endRef} />
            </div>

            <div className="shrink-0 border-t border-border p-3">
              <div className="flex items-end gap-2 rounded-lg border border-border-strong bg-background px-3 py-2 focus-within:border-primary">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (draft.trim()) submit(draft);
                    }
                  }}
                  placeholder="Ask about the numbers…"
                  className="max-h-[140px] flex-1 resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
                <button
                  onClick={() => draft.trim() && submit(draft)}
                  disabled={!draft.trim() || isThinking}
                  aria-label="Send"
                  className="mb-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-40"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Answers come from your live data. Check anything you're about to act on.
              </p>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
