import { Shield, Construction } from "lucide-react";
import { cn } from "@/lib/utils";

export default function WHSAuditTemplates() {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-6")}>
      <div className="flex items-center gap-3 mb-6">
        <Shield className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold text-card-foreground">WHS Audit Templates</h2>
      </div>
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Construction className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-base font-semibold text-card-foreground mb-2">
          Coming soon &mdash; Phase 4
        </h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Design WHS audit templates with sections and questions.
        </p>
      </div>
    </div>
  );
}
