import { useState } from "react";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useNewHireActions } from "@/hooks/useNewHires";
import type { NewHire } from "@/types";

const selectCls =
  "h-9 w-full rounded-lg border border-border-strong bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const ROLES: { value: NewHire["role"]; label: string }[] = [
  { value: "team_member", label: "Team member" },
  { value: "shift_supervisor", label: "Shift supervisor" },
  { value: "staff", label: "Staff (office / admin)" },
  { value: "manager", label: "Manager" },
];

/**
 * Five fields, because that is all a manager has to hand when they hire someone
 * on the floor. Everything else the new hire fills in themselves, which is both
 * less work for the manager and more accurate.
 */
export function NewHireDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (hire: NewHire) => void;
}) {
  const { data: venues = [] } = useRestaurants();
  const { create } = useNewHireActions();

  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [venueId, setVenueId] = useState(venues[0]?.id ?? "");
  const [role, setRole] = useState<NewHire["role"]>("team_member");
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [positionTitle, setPositionTitle] = useState("");

  const venue = venues.find((v) => v.id === venueId);

  const handleSave = async () => {
    if (!fullName.trim()) return toast.error("Enter their name");
    if (!mobile.trim()) return toast.error("Enter a mobile number");
    if (!venue) return toast.error("Pick a venue");
    if (!venue.brand_id) {
      return toast.error(
        `${venue.name} isn't assigned to a brand yet — set that under Settings → Venues first.`
      );
    }
    try {
      const hire = await create.mutateAsync({
        brand_id: venue.brand_id,
        restaurant_id: venue.id,
        full_name: fullName,
        mobile,
        role,
        position_title: positionTitle,
        start_date: startDate,
      });
      onCreated(hire);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add the hire");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a new hire</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          You'll get a link and a QR code to hand them. They fill in the rest on their phone —
          no email needed.
        </p>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="hire-name">Name</Label>
            <Input
              id="hire-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="As they'd like to be called"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hire-mobile">Mobile</Label>
            <Input
              id="hire-mobile"
              type="tel"
              inputMode="tel"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="04…"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hire-venue">Venue</Label>
            <select
              id="hire-venue"
              className={selectCls}
              value={venueId}
              onChange={(e) => setVenueId(e.target.value)}
            >
              <option value="">Pick a venue</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hire-role">Role</Label>
              <select
                id="hire-role"
                className={selectCls}
                value={role}
                onChange={(e) => setRole(e.target.value as NewHire["role"])}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hire-start">Start date</Label>
              <Input
                id="hire-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hire-title">Job title (optional)</Label>
            <Input
              id="hire-title"
              value={positionTitle}
              onChange={(e) => setPositionTitle(e.target.value)}
              placeholder="e.g. Front of house"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={create.isPending}>
            {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Create invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
