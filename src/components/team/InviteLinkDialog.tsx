import { useMemo, useState } from "react";
import { Check, Copy, Loader2, QrCode, RefreshCw } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNewHireActions } from "@/hooks/useNewHires";
import { qrSvgPath } from "@/lib/qr";
import type { NewHire } from "@/types";

export function inviteUrl(token: string): string {
  return `${window.location.origin}/join/${token}`;
}

/**
 * How a new hire actually gets their form: a link to copy into a text message,
 * and a QR code to hold up so they can point their phone at it. No email is
 * sent and none is needed — plenty of hospitality hires don't check one.
 *
 * The link is a credential, so the dialog says so and offers a way to replace
 * it if it ends up somewhere it shouldn't.
 */
export function InviteLinkDialog({
  hire,
  onClose,
}: {
  hire: NewHire;
  onClose: () => void;
}) {
  const { reissueInvite } = useNewHireActions();
  const [token, setToken] = useState(hire.invite_token);
  const [copied, setCopied] = useState(false);

  const url = inviteUrl(token);
  const qr = useMemo(() => qrSvgPath(url), [url]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the link and copy it by hand.");
    }
  };

  const reissue = async () => {
    if (!confirm("Create a new link? The current one stops working straight away.")) return;
    try {
      const fresh = await reissueInvite.mutateAsync({ id: hire.id });
      setToken(fresh);
      toast.success("New link created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create a new link");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{hire.full_name}'s onboarding link</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Text them the link, or let them scan the code. Anyone with this link can fill in
          the form, so don't post it anywhere shared.
        </p>

        {/* Scanned off a screen, so it needs a white quiet zone regardless of
            theme — a QR on a dark card does not read. */}
        <div className="flex justify-center rounded-xl border border-border bg-white p-4">
          <svg
            viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`}
            className="h-48 w-48"
            role="img"
            aria-label={`QR code for ${hire.full_name}'s onboarding link`}
            shapeRendering="crispEdges"
          >
            <rect x={-2} y={-2} width={qr.size + 4} height={qr.size + 4} fill="#fff" />
            <path d={qr.path} fill="#0E1726" />
          </svg>
        </div>

        <div className="space-y-1.5">
          <div className="flex gap-2">
            <Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button type="button" variant="outline" onClick={copy} className="shrink-0">
              {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Works until {format(parseISO(hire.invite_expires_at), "d MMM yyyy")}.
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <Button type="button" variant="ghost" size="sm" onClick={reissue} disabled={reissueInvite.isPending}>
            {reissueInvite.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            New link
          </Button>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Small inline trigger used in list rows. */
export function InviteLinkButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      <QrCode className="h-3.5 w-3.5" />
      Invite link
    </Button>
  );
}
