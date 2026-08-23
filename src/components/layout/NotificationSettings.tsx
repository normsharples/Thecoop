import { useState } from "react";
import { Mail, BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { usePush } from "@/hooks/usePush";
import { cn } from "@/lib/utils";

export function NotificationSettings() {
  const { profile } = useAuth();
  const [email, setEmail] = useState(profile?.notification_prefs?.email !== false);
  const { supported, status, enable, disable } = usePush(profile?.id);

  const toggleEmail = async (v: boolean) => {
    if (!profile) return;
    setEmail(v);
    const next = { ...(profile.notification_prefs ?? {}), email: v };
    const { error } = await supabase
      .from("profiles")
      .update({ notification_prefs: next })
      .eq("id", profile.id);
    if (error) {
      setEmail(!v);
      toast.error("Couldn't save preference");
    }
  };

  return (
    <div className="space-y-2 px-3 py-2.5">
      {/* Email */}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm text-popover-foreground">
          <Mail className="h-4 w-4 text-muted-foreground" /> Email
        </span>
        <button
          role="switch"
          aria-checked={email}
          onClick={() => toggleEmail(!email)}
          className={cn(
            "relative h-5 w-9 rounded-full transition-colors",
            email ? "bg-primary" : "bg-muted"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
              email ? "translate-x-4" : "translate-x-0.5"
            )}
          />
        </button>
      </div>

      {/* Push */}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm text-popover-foreground">
          <BellRing className="h-4 w-4 text-muted-foreground" /> Push (this device)
        </span>
        {status === "busy" ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : status === "on" ? (
          <button onClick={() => disable()} className="text-xs font-medium text-muted-foreground hover:text-foreground">
            Turn off
          </button>
        ) : status === "off" ? (
          <button onClick={() => enable()} className="text-xs font-medium text-primary hover:underline">
            Enable
          </button>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            {status === "denied"
              ? "Blocked in browser"
              : status === "unsupported"
              ? "Not supported"
              : "Not configured"}
          </span>
        )}
      </div>
      {!supported && (
        <p className="text-[11px] text-muted-foreground">
          Install the app to your home screen to enable push on mobile.
        </p>
      )}
    </div>
  );
}
