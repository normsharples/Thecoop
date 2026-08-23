import { useState } from "react";
import { CalendarCheck, Plane } from "lucide-react";
import { cn } from "@/lib/utils";
import AvailabilityEditor from "./AvailabilityEditor";
import LeavePanel from "./LeavePanel";

/** Availability + Leave tabs for the logged-in person. */
export default function MyPortal({ employeeId }: { employeeId: string }) {
  const [tab, setTab] = useState<"availability" | "leave">("availability");
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-border p-0.5">
        <button
          onClick={() => setTab("availability")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
            tab === "availability" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <CalendarCheck className="h-4 w-4" /> Availability
        </button>
        <button
          onClick={() => setTab("leave")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
            tab === "leave" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Plane className="h-4 w-4" /> Leave
        </button>
      </div>
      {tab === "availability" ? (
        <AvailabilityEditor employeeId={employeeId} />
      ) : (
        <LeavePanel employeeId={employeeId} />
      )}
    </div>
  );
}
