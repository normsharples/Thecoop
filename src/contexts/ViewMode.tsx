import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

// ============================================================================
// VIEW MODE — "operations" vs "staff"
// ----------------------------------------------------------------------------
// A superadmin can drop the app into staff mode from the header to see exactly
// what a team member sees: My Roster, My Availability, My Profile, and nothing
// else. Useful for checking a change before it lands on 23 people's phones.
//
// ⚠ This is a UI-LEVEL PREVIEW, NOT A SECURITY BOUNDARY. The Supabase session
// is unchanged, so RLS still treats the person as a superadmin — every query
// they could run in operations mode still succeeds in staff mode. It hides
// screens; it does not revoke access. Never use it to hand an untrusted person
// a "safe" logged-in session.
// ============================================================================

export type ViewMode = "operations" | "staff";

const STORAGE_KEY = "coop.viewMode";

interface ViewModeState {
  /** The mode actually in force (always "operations" for non-superadmins). */
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
  toggle: () => void;
  /** True when the signed-in person is allowed to switch (real superadmin). */
  canSwitch: boolean;
  /** Set by the provider's consumer once the real role is known. */
  setCanSwitch: (allowed: boolean) => void;
}

const ViewModeContext = createContext<ViewModeState | null>(null);

function readStored(): ViewMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "staff" ? "staff" : "operations";
  } catch {
    return "operations";
  }
}

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
  const [stored, setStored] = useState<ViewMode>(readStored);
  const [canSwitch, setCanSwitch] = useState(false);

  const setMode = useCallback((next: ViewMode) => {
    setStored(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private browsing — the mode just won't survive a reload */
    }
  }, []);

  // Someone who can't switch is always in operations mode, and shouldn't carry
  // a stale "staff" flag around (e.g. a shared machine, or a demoted account).
  useEffect(() => {
    if (!canSwitch && stored !== "operations") setMode("operations");
  }, [canSwitch, stored, setMode]);

  const mode: ViewMode = canSwitch ? stored : "operations";

  const value = useMemo<ViewModeState>(
    () => ({
      mode,
      setMode,
      toggle: () => setMode(mode === "staff" ? "operations" : "staff"),
      canSwitch,
      setCanSwitch,
    }),
    [mode, setMode, canSwitch]
  );

  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>;
}

export function useViewMode(): ViewModeState {
  const ctx = useContext(ViewModeContext);
  if (ctx) return ctx;
  // Rendered outside the provider (tests, storybook) — behave as a plain
  // operations-mode user rather than exploding.
  return {
    mode: "operations",
    setMode: () => {},
    toggle: () => {},
    canSwitch: false,
    setCanSwitch: () => {},
  };
}
