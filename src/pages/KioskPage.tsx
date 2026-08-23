import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, Coffee, Delete, LogIn, LogOut, Play, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useKiosk, clockState, type KioskStaff } from "@/hooks/useTimeClock";
import { formatTime } from "@/lib/roster";
import { getInitials, cn } from "@/lib/utils";

export default function KioskPage() {
  const { profile, isLoading } = useAuth();
  const { role } = usePermissions();
  const isManager =
    role === "superadmin" || role === "area_manager" || role === "manager";

  const { data: stores = [] } = useQuery({
    queryKey: ["kiosk-stores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id, name")
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
    enabled: isManager,
  });

  const [storeId, setStoreId] = useState<string | null>(null);
  const activeStore = storeId ?? (stores.length === 1 ? stores[0].id : null);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!profile) return <Navigate to="/login" replace />;
  if (!isManager) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <Link
          to="/rostering"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Exit kiosk
        </Link>
        <h1 className="text-lg font-bold text-foreground">Time clock</h1>
        <span className="text-sm tabular-nums text-muted-foreground">
          {format(new Date(), "EEE d MMM · h:mm a")}
        </span>
      </header>

      {!activeStore ? (
        <div className="mx-auto max-w-md px-4 py-10">
          <h2 className="mb-4 text-center text-base font-semibold text-foreground">
            Choose this tablet's store
          </h2>
          <div className="space-y-2">
            {stores.map((s) => (
              <button
                key={s.id}
                onClick={() => setStoreId(s.id)}
                className="w-full rounded-xl border border-border bg-card px-4 py-4 text-left text-base font-medium text-foreground hover:bg-accent"
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <KioskGrid
          storeId={activeStore}
          storeName={stores.find((s) => s.id === activeStore)?.name ?? ""}
          canSwitch={stores.length > 1}
          onSwitch={() => setStoreId(null)}
        />
      )}
    </div>
  );
}

function KioskGrid({
  storeId,
  storeName,
  canSwitch,
  onSwitch,
}: {
  storeId: string;
  storeName: string;
  canSwitch: boolean;
  onSwitch: () => void;
}) {
  const { staff, isLoading, verifyPin, punch } = useKiosk(storeId);
  const [selected, setSelected] = useState<KioskStaff | null>(null);

  return (
    <div className="px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">{storeName}</h2>
        {canSwitch && (
          <button onClick={onSwitch} className="text-sm text-muted-foreground hover:text-foreground">
            Switch store
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : staff.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card py-16 text-center text-sm text-muted-foreground">
          Nobody rostered here today. Staff whose home store is this venue will also appear.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {staff.map((s) => {
            const st = clockState(s.entry);
            return (
              <button
                key={s.profile.id}
                onClick={() => setSelected(s)}
                className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card p-4 text-center hover:bg-accent"
              >
                <span
                  className="flex h-14 w-14 items-center justify-center rounded-full text-lg font-semibold text-white"
                  style={{ backgroundColor: s.profile.display_colour ?? "#64748b" }}
                >
                  {getInitials(s.profile.full_name)}
                </span>
                <span className="text-sm font-medium leading-tight text-foreground">
                  {s.profile.full_name}
                </span>
                <StatusPill state={st} />
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <PinSheet
          staff={selected}
          onClose={() => setSelected(null)}
          verifyPin={verifyPin}
          punch={punch}
        />
      )}
    </div>
  );
}

function StatusPill({ state }: { state: ReturnType<typeof clockState> }) {
  const map = {
    out: ["Off", "bg-muted text-muted-foreground"],
    done: ["Done", "bg-muted text-muted-foreground"],
    in: ["On clock", "bg-success/15 text-success"],
    on_break: ["On break", "bg-warning/15 text-warning"],
  } as const;
  const [label, cls] = map[state];
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", cls)}>{label}</span>;
}

function PinSheet({
  staff,
  onClose,
  verifyPin,
  punch,
}: {
  staff: KioskStaff;
  onClose: () => void;
  verifyPin: (employeeId: string, pin: string) => Promise<boolean>;
  punch: (p: {
    employeeId: string;
    action: "in" | "break_start" | "break_end" | "out";
    shiftId?: string | null;
    entryId?: string | null;
  }) => Promise<unknown>;
}) {
  const [pin, setPin] = useState("");
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const state = clockState(staff.entry);

  const submitPin = async () => {
    setBusy(true);
    try {
      const ok = await verifyPin(staff.profile.id, pin);
      if (ok) setVerified(true);
      else {
        toast.error("Wrong PIN");
        setPin("");
      }
    } catch (e) {
      toast.error((e as { message?: string })?.message || "Couldn't check PIN");
    } finally {
      setBusy(false);
    }
  };

  const doPunch = async (action: "in" | "break_start" | "break_end" | "out", ok: string) => {
    setBusy(true);
    try {
      await punch({
        employeeId: staff.profile.id,
        action,
        shiftId: staff.shift?.id ?? null,
        entryId: staff.entry?.id ?? null,
      });
      toast.success(`${staff.profile.full_name.split(" ")[0]}: ${ok}`);
      onClose();
    } catch (e) {
      toast.error((e as { message?: string })?.message || "Couldn't record that");
    } finally {
      setBusy(false);
    }
  };

  const press = (d: string) => setPin((p) => (p.length >= 6 ? p : p + d));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-xs rounded-2xl border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="font-semibold text-foreground">{staff.profile.full_name}</span>
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-accent">
            <X className="h-5 w-5" />
          </button>
        </div>

        {staff.shift && (
          <p className="mb-3 text-center text-sm text-muted-foreground">
            Rostered {formatTime(staff.shift.start_time)}–{formatTime(staff.shift.end_time)}
          </p>
        )}

        {!verified ? (
          <>
            <div className="mb-4 flex justify-center gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-3 w-3 rounded-full",
                    i < pin.length ? "bg-primary" : "bg-muted"
                  )}
                />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <KeyBtn key={d} onClick={() => press(d)}>
                  {d}
                </KeyBtn>
              ))}
              <KeyBtn onClick={() => setPin((p) => p.slice(0, -1))}>
                <Delete className="mx-auto h-5 w-5" />
              </KeyBtn>
              <KeyBtn onClick={() => press("0")}>0</KeyBtn>
              <KeyBtn onClick={submitPin} disabled={pin.length < 4 || busy} variant="primary">
                {busy ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : "OK"}
              </KeyBtn>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            {(state === "out" || state === "done") && (
              <ActionBtn onClick={() => doPunch("in", "clocked in")} disabled={busy} variant="primary">
                <LogIn className="h-5 w-5" /> Clock in
              </ActionBtn>
            )}
            {state === "in" && (
              <>
                <ActionBtn onClick={() => doPunch("break_start", "on break")} disabled={busy}>
                  <Coffee className="h-5 w-5" /> Start break
                </ActionBtn>
                <ActionBtn onClick={() => doPunch("out", "clocked out")} disabled={busy} variant="danger">
                  <LogOut className="h-5 w-5" /> Clock out
                </ActionBtn>
              </>
            )}
            {state === "on_break" && (
              <>
                <ActionBtn onClick={() => doPunch("break_end", "back from break")} disabled={busy} variant="primary">
                  <Play className="h-5 w-5" /> End break
                </ActionBtn>
                <ActionBtn onClick={() => doPunch("out", "clocked out")} disabled={busy} variant="danger">
                  <LogOut className="h-5 w-5" /> Clock out
                </ActionBtn>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function KeyBtn({
  children,
  onClick,
  disabled,
  variant = "neutral",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "neutral";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-xl py-4 text-xl font-semibold transition-colors disabled:opacity-40",
        variant === "primary"
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "bg-muted text-foreground hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}

function ActionBtn({
  children,
  onClick,
  disabled,
  variant = "neutral",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "danger" | "neutral";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center justify-center gap-2 rounded-xl py-4 text-base font-semibold transition-colors disabled:opacity-50",
        variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90",
        variant === "danger" && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        variant === "neutral" && "border border-border text-foreground hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}
