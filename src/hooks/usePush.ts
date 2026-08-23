import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export type PushStatus =
  | "unsupported"    // browser can't do web push
  | "unconfigured"   // no VAPID public key set
  | "denied"         // user blocked notifications
  | "off"            // supported but not subscribed
  | "on"             // subscribed on this device
  | "busy";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/** Manage this device's web-push subscription for the signed-in user. */
export function usePush(userId?: string) {
  const supported =
    typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
  const [status, setStatus] = useState<PushStatus>("off");

  const refresh = useCallback(async () => {
    if (!supported) return setStatus("unsupported");
    if (!VAPID_PUBLIC) return setStatus("unconfigured");
    if (Notification.permission === "denied") return setStatus("denied");
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    setStatus(sub ? "on" : "off");
  }, [supported]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    if (!supported || !VAPID_PUBLIC || !userId) return;
    setStatus("busy");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setStatus(perm === "denied" ? "denied" : "off");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource,
      });
      const json = sub.toJSON();
      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          user_id: userId,
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
        },
        { onConflict: "user_id,endpoint" }
      );
      if (error) throw error;
      setStatus("on");
    } catch {
      setStatus("off");
    }
  }, [supported, userId]);

  const disable = useCallback(async () => {
    setStatus("busy");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
      setStatus("off");
    } catch {
      refresh();
    }
  }, [refresh]);

  return { supported, status, enable, disable };
}
