import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, User, ChevronDown, Eye, LayoutDashboard } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useViewMode } from "@/contexts/ViewMode";
import { cn } from "@/lib/utils";
import { RestaurantSwitcher } from "./RestaurantSwitcher";
import { BrandSwitcher } from "./BrandSwitcher";
import { NotificationBell } from "./NotificationBell";
import { getInitials } from "@/lib/utils";

interface TopbarProps {
  pageTitle: string;
}

export function Topbar({ pageTitle }: TopbarProps) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="sticky top-0 z-40 flex h-[60px] shrink-0 items-center gap-4 border-b border-border bg-card px-4 lg:px-6">
      {/* The page name leads, set in the serif — it is the one editorial note
          in an otherwise dense, tabular interface. */}
      <h1 className="truncate font-display text-[22px] font-semibold tracking-tight text-foreground">
        {pageTitle}
      </h1>

      <div className="ml-auto flex items-center gap-2">
        <ViewModeSwitch />
        <BrandSwitcher />
        <RestaurantSwitcher />
        <NotificationBell />

        {/* Below `lg` the sidebar is hidden, so the account menu lives here. */}
        <div className="relative lg:hidden" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-accent"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
              {profile ? getInitials(profile.full_name) : "?"}
            </div>
            <span className="hidden max-w-[120px] truncate font-medium text-foreground md:block">
              {profile?.full_name ?? "User"}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-popover p-1 shadow-popover">
              <div className="mb-1 border-b border-border px-3 py-2">
                <p className="text-sm font-medium text-popover-foreground">
                  {profile?.full_name}
                </p>
                <p className="truncate text-xs text-muted-foreground">{profile?.email}</p>
              </div>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  navigate("/my-profile");
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-popover-foreground transition-colors hover:bg-accent"
              >
                <User className="h-4 w-4" />
                My profile
              </button>
              <button
                onClick={async () => {
                  setMenuOpen(false);
                  await signOut();
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive-soft"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * Operations ⇄ Staff switch. Only a real superadmin sees it.
 *
 * Staff mode narrows the app to what a team member sees. It is a PREVIEW, not
 * a permission drop — the Supabase session is untouched, so RLS still answers
 * as a superadmin. The amber pill is there so nobody forgets which mode
 * they're in and reports a "missing" page as a bug.
 */
function ViewModeSwitch() {
  const { isRealSuperadmin } = usePermissions();
  const { mode, setMode } = useViewMode();

  if (!isRealSuperadmin) return null;

  const options = [
    { value: "operations" as const, label: "Operations", Icon: LayoutDashboard },
    { value: "staff" as const, label: "Staff", Icon: Eye },
  ];

  return (
    <div
      role="group"
      aria-label="View mode"
      className={cn(
        "flex items-center gap-0.5 rounded-lg border p-0.5",
        mode === "staff" ? "border-warning bg-warning-soft" : "border-border bg-secondary"
      )}
    >
      {options.map(({ value, label, Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            aria-pressed={active}
            title={
              value === "staff"
                ? "Preview the app as a team member sees it"
                : "Back to the full operations view"
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
