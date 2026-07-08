import { Wrench, Construction } from "lucide-react";
import { cn } from "@/lib/utils";

export default function MaintenancePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Wrench className="h-7 w-7 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Maintenance</h1>
      </div>

      <div className={cn("rounded-xl border border-border bg-card p-6")}>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Construction className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-semibold text-card-foreground mb-2">
            Coming soon &mdash; Phase 3
          </h2>
          <p className="text-sm text-muted-foreground max-w-md">
            Equipment maintenance tracking with Kanban board, scheduled
            maintenance, and cost tracking.
          </p>
        </div>
      </div>
    </div>
  );
}
