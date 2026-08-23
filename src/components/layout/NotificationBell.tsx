import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { useNotifications } from "@/hooks/useNotifications";
import { NotificationSettings } from "./NotificationSettings";
import { cn } from "@/lib/utils";
import type { Notification } from "@/types";

export function NotificationBell() {
  const { items, unread, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const handleClick = async (n: Notification) => {
    if (!n.read_at) await markRead(n.id).catch(() => {});
    const path = typeof n.data?.path === "string" ? n.data.path : null;
    setOpen(false);
    if (path) navigate(path);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        title="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold text-popover-foreground">Notifications</span>
            {unread > 0 && (
              <button
                onClick={() => markAllRead().catch(() => {})}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                You're all caught up.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => handleClick(n)}
                      className={cn(
                        "flex w-full gap-2 px-3 py-2.5 text-left transition-colors hover:bg-accent",
                        !n.read_at && "bg-primary/5"
                      )}
                    >
                      <span
                        className={cn(
                          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                          n.read_at ? "bg-transparent" : "bg-primary"
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-popover-foreground">
                          {n.title}
                        </span>
                        {n.body && (
                          <span className="block text-xs text-muted-foreground">{n.body}</span>
                        )}
                        <span className="mt-0.5 block text-[11px] text-muted-foreground/70">
                          {formatDistanceToNow(parseISO(n.created_at), { addSuffix: true })}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-border">
            <NotificationSettings />
          </div>
        </div>
      )}
    </div>
  );
}
