import { LogOut, Lock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { OrbitWordmark } from "@/components/brand/OrbitLogo";

/**
 * Shown instead of the app once Offboarding has revoked someone's access.
 *
 * Their auth user still exists — payroll, timesheets and incident records all
 * reference the profile, so deleting it would take those with it — which means
 * they can still sign in. This is the wall they meet when they do. No nav, no
 * data, and a plain explanation rather than a permissions error.
 */
export function AccessRevokedScreen() {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-5 rounded-xl border border-border bg-card p-6 text-center">
        <OrbitWordmark className="mx-auto text-[22px] text-foreground" />
        <div className="flex justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunken">
            <Lock className="h-5 w-5 text-muted-foreground" />
          </span>
        </div>
        <div className="space-y-2">
          <h1 className="font-display text-xl font-semibold text-foreground">
            Your access has ended
          </h1>
          <p className="text-sm text-muted-foreground">
            Thanks for everything. Your login no longer opens ORBIT. If you think this is
            wrong, speak to your manager — they can switch it back on.
          </p>
        </div>
        <Button variant="outline" className="w-full" onClick={() => void signOut()}>
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </div>
  );
}
