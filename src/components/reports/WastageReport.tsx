import { Construction } from "lucide-react";
import { cn } from "@/lib/utils";

export default function WastageReport() {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-6")}>
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Construction className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-lg font-semibold text-card-foreground mb-2">
          Coming soon &mdash; Phase 2
        </h2>
        <p className="text-sm text-muted-foreground max-w-md">
          Waste tracking by category with cost impact and trend analysis.
        </p>
      </div>
    </div>
  );
}
