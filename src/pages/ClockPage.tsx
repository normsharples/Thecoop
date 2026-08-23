import { Link } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import ClockCard from "@/components/portal/ClockCard";

/**
 * Stand-alone clock in/out, deliberately OUTSIDE the onboarding gate.
 *
 * Paperwork must never stop someone being paid for hours they worked, so this
 * route stays reachable while onboarding is incomplete.
 */
export default function ClockPage() {
  const { profile, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!profile) return null;

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto w-full max-w-md space-y-4">
        <Link
          to="/onboarding"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to onboarding
        </Link>
        <ClockCard profile={profile} />
      </div>
    </div>
  );
}
