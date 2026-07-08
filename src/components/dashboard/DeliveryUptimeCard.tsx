import { Wifi } from "lucide-react";

export function DeliveryUptimeCard() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 opacity-60">
      <div className="flex items-start justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Delivery Uptime</p>
        <div className="rounded-md bg-muted p-1.5 text-muted-foreground">
          <Wifi className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-2 text-2xl font-bold text-muted-foreground">—</p>
      <p className="mt-0.5 text-xs text-muted-foreground">This week</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="text-sm font-medium text-muted-foreground">—</span>
        <span className="text-xs text-muted-foreground">not yet configured</span>
      </div>
    </div>
  );
}
