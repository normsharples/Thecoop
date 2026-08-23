import { CalendarCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import MyPortal from "@/components/portal/MyPortal";

export default function MyAvailabilityPage() {
  const { profile } = useAuth();
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="flex items-center gap-2">
        <CalendarCheck className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">My availability</h1>
      </div>
      {profile && <MyPortal employeeId={profile.id} />}
    </div>
  );
}
