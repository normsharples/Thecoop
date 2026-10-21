import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { format } from "date-fns";
import {
  CheckCircle2,
  ClipboardList,
  Link2Off,
  Loader2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { OrbitWordmark } from "@/components/brand/OrbitLogo";
import { cn } from "@/lib/utils";

// ============================================================================
// PUBLIC STORE SHEET
// ----------------------------------------------------------------------------
// Opened from a shareable link — no login required. The venue token in the URL
// is the only credential. Every call is an anon-key RPC (migration 097).
//
// Built for a phone: single-column, large touch targets, minimal chrome.
// ============================================================================

interface VenueInfo {
  venue_id: string;
  venue_name: string;
}

export default function PublicStoreSheetPage() {
  const { token } = useParams<{ token: string }>();
  const [venue, setVenue] = useState<VenueInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Form state
  const today = format(new Date(), "yyyy-MM-dd");
  const [sheetDate, setSheetDate] = useState(today);
  const [submittedBy, setSubmittedBy] = useState("");
  const [shiftNotes, setShiftNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Look up venue by token on mount
  useEffect(() => {
    if (!token) {
      setInvalid(true);
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc(
          "get_venue_by_token",
          { p_token: token }
        );
        if (rpcError) throw rpcError;

        const result = typeof data === "string" ? JSON.parse(data) : data;
        if (!result?.ok) {
          setInvalid(true);
        } else {
          setVenue({
            venue_id: result.venue_id,
            venue_name: result.venue_name,
          });
        }
      } catch {
        setInvalid(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !venue) return;

    setError(null);
    setSaving(true);

    try {
      const { data, error: rpcError } = await supabase.rpc(
        "submit_store_sheet",
        {
          p_token: token,
          p_date: sheetDate,
          p_submitted_by: submittedBy.trim(),
          p_shift_notes: shiftNotes.trim(),
        }
      );
      if (rpcError) throw rpcError;

      const result = typeof data === "string" ? JSON.parse(data) : data;
      if (!result?.ok) {
        setError(result?.error ?? "Something went wrong");
      } else {
        setSubmitted(true);
      }
    } catch {
      setError("Failed to submit. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // ── Loading ──────────────────────────────────────────────────
  if (loading) {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading form...
        </div>
      </Shell>
    );
  }

  // ── Invalid / disabled token ─────────────────────────────────
  if (invalid || !venue) {
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
              It may have been disabled or replaced with a new one.
            </p>
            <p className="text-sm text-muted-foreground">
              Ask your manager for the current link.
            </p>
          </div>
        </div>
      </Shell>
    );
  }

  // ── Success ──────────────────────────────────────────────────
  if (submitted) {
    return (
      <Shell venueName={venue.venue_name}>
        <div className="space-y-4 py-10 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-soft">
            <CheckCircle2 className="h-6 w-6 text-success" />
          </span>
          <div className="space-y-1.5">
            <h1 className="font-display text-2xl font-semibold text-foreground">
              Sheet submitted
            </h1>
            <p className="text-sm text-muted-foreground">
              Thanks{submittedBy ? `, ${submittedBy.split(" ")[0]}` : ""}! The
              daily sheet for{" "}
              {sheetDate === today
                ? "today"
                : format(new Date(sheetDate + "T00:00:00"), "EEEE d MMM")}{" "}
              has been saved.
            </p>
          </div>

          <button
            onClick={() => {
              setSubmitted(false);
              setShiftNotes("");
              setSheetDate(format(new Date(), "yyyy-MM-dd"));
            }}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            <ClipboardList className="h-4 w-4" />
            Submit another
          </button>
        </div>
      </Shell>
    );
  }

  // ── Form ─────────────────────────────────────────────────────
  return (
    <Shell venueName={venue.venue_name}>
      <div className="space-y-1 mb-6">
        <h1 className="font-display text-xl font-semibold text-foreground flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" />
          Daily Sheet
        </h1>
        <p className="text-sm text-muted-foreground">
          End-of-shift summary for {venue.venue_name}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Date */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-1.5">
          <label
            htmlFor="sheet-date"
            className="text-sm font-semibold text-card-foreground"
          >
            Date
          </label>
          <input
            id="sheet-date"
            type="date"
            value={sheetDate}
            max={today}
            onChange={(e) => setSheetDate(e.target.value)}
            required
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        {/* Submitted by */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-1.5">
          <label
            htmlFor="submitted-by"
            className="text-sm font-semibold text-card-foreground"
          >
            Your name
          </label>
          <input
            id="submitted-by"
            type="text"
            value={submittedBy}
            onChange={(e) => setSubmittedBy(e.target.value)}
            placeholder="e.g. Sarah M"
            required
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        {/* Shift notes */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-1.5">
          <label
            htmlFor="shift-notes"
            className="text-sm font-semibold text-card-foreground"
          >
            Shift Notes
          </label>
          <p className="text-xs text-muted-foreground">
            Anything notable from today — staffing issues, equipment problems,
            customer feedback, deliveries, or things the next shift should know.
          </p>
          <textarea
            id="shift-notes"
            value={shiftNotes}
            onChange={(e) => setShiftNotes(e.target.value)}
            rows={5}
            placeholder="How did the shift go today?"
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y min-h-[120px]"
          />
        </div>

        {/* Error */}
        {error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={saving || !submittedBy.trim()}
          className={cn(
            "w-full rounded-lg px-4 py-3 text-sm font-semibold transition-colors",
            "bg-primary text-primary-foreground hover:bg-primary-hover",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {saving ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Submitting...
            </span>
          ) : (
            "Submit Daily Sheet"
          )}
        </button>
      </form>
    </Shell>
  );
}

// ── Shell — matches the NewHireIntakePage pattern ──────────────────────────

function Shell({
  children,
  venueName,
}: {
  children: React.ReactNode;
  venueName?: string;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-4 py-3.5">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <OrbitWordmark className="text-[18px] text-foreground" />
          {venueName && (
            <span className="truncate text-[13px] text-muted-foreground">
              {venueName}
            </span>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-5 pb-24">{children}</main>
    </div>
  );
}
