import { Landmark, Construction } from "lucide-react";
import { cn } from "@/lib/utils";

export default function BankAccounts() {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-6")}>
      <div className="flex items-center gap-3 mb-6">
        <Landmark className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold text-card-foreground">Bank Accounts</h2>
      </div>
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Construction className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-base font-semibold text-card-foreground mb-2">
          Coming soon &mdash; Phase 3
        </h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Manage bank account details for cash deposit tracking.
        </p>
      </div>
    </div>
  );
}
