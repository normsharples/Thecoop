import { useState } from "react";
import { CalendarRange, Plane, CalendarDays, CalendarCheck, ArrowLeftRight, Clock, Banknote } from "lucide-react";
import RosterBuilder from "@/components/rostering/RosterBuilder";
import LeaveApprovals from "@/components/rostering/LeaveApprovals";
import SwapApprovals from "@/components/rostering/SwapApprovals";
import TimesheetReview from "@/components/rostering/TimesheetReview";
import PayRun from "@/components/rostering/PayRun";
import MyShiftsList from "@/components/portal/MyShiftsList";
import MyPortal from "@/components/portal/MyPortal";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

type Tab = "build" | "timesheets" | "payrun" | "approvals" | "swaps" | "my-roster" | "my-availability";

const TABS: { key: Tab; label: string; icon: typeof CalendarRange }[] = [
  { key: "build", label: "Build", icon: CalendarRange },
  { key: "timesheets", label: "Timesheets", icon: Clock },
  { key: "payrun", label: "Pay run", icon: Banknote },
  { key: "approvals", label: "Leave approvals", icon: Plane },
  { key: "swaps", label: "Swaps", icon: ArrowLeftRight },
  { key: "my-roster", label: "My roster", icon: CalendarDays },
  { key: "my-availability", label: "My availability", icon: CalendarCheck },
];

export default function RosteringPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>("build");
  const firstName = (profile?.full_name ?? "").split(" ")[0] || "there";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "build" ? (
        <RosterBuilder />
      ) : tab === "timesheets" ? (
        <TimesheetReview />
      ) : tab === "payrun" ? (
        <PayRun />
      ) : tab === "approvals" ? (
        <LeaveApprovals />
      ) : tab === "swaps" ? (
        <SwapApprovals />
      ) : !profile ? null : tab === "my-roster" ? (
        <div className="mx-auto max-w-xl">
          <MyShiftsList profileId={profile.id} greetingName={firstName} />
        </div>
      ) : (
        <div className="mx-auto max-w-xl">
          <MyPortal employeeId={profile.id} />
        </div>
      )}
    </div>
  );
}
