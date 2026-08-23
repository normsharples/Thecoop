import { useState } from "react";
import { CalendarRange, CalendarCheck, Plane, ArrowLeftRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import MyShiftsList from "@/components/portal/MyShiftsList";
import AvailabilityEditor from "@/components/portal/AvailabilityEditor";
import LeavePanel from "@/components/portal/LeavePanel";
import SwapsPanel from "@/components/portal/SwapsPanel";
import ClockCard from "@/components/portal/ClockCard";

type Tab = "roster" | "availability" | "leave" | "swaps";

export default function MyRosterPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>("roster");
  const firstName = (profile?.full_name ?? "").split(" ")[0] || "there";

  const btn = (key: Tab, label: string, Icon: typeof CalendarRange) => (
    <button
      onClick={() => setTab(key)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
        tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="flex items-center gap-2">
        <CalendarRange className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">My roster</h1>
      </div>

      <div className="flex flex-wrap gap-0.5 rounded-lg border border-border p-0.5">
        {btn("roster", "Roster", CalendarRange)}
        {btn("availability", "Availability", CalendarCheck)}
        {btn("leave", "Leave", Plane)}
        {btn("swaps", "Swaps", ArrowLeftRight)}
      </div>

      {!profile ? null : tab === "roster" ? (
        <div className="space-y-5">
          <ClockCard profile={profile} />
          <MyShiftsList profileId={profile.id} greetingName={firstName} />
        </div>
      ) : tab === "availability" ? (
        <AvailabilityEditor employeeId={profile.id} />
      ) : tab === "leave" ? (
        <LeavePanel employeeId={profile.id} />
      ) : (
        <SwapsPanel employeeId={profile.id} />
      )}
    </div>
  );
}
