import { useEffect, useRef, useState } from "react";
import { Eraser, PenLine, Type } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Draw-to-sign with a typed fallback.
 *
 * Legally the typed name plus the audit trail (time, IP, user agent, document
 * hash) is what carries weight under the Electronic Transactions Act — the
 * drawn squiggle adds nothing in law, but it makes people treat the moment as
 * signing, which is what actually gets contracts finished.
 */
export default function SignaturePad({
  name,
  onNameChange,
  onSignatureChange,
}: {
  name: string;
  onNameChange: (v: string) => void;
  onSignatureChange: (dataUrl: string | null) => void;
}) {
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  // Size the canvas to its box at device pixel ratio so lines aren't fuzzy.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || mode !== "draw") return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#111827";
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [mode]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    dirty.current = true;
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (dirty.current && canvasRef.current) {
      onSignatureChange(canvasRef.current.toDataURL("image/png"));
    }
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    dirty.current = false;
    onSignatureChange(null);
  };

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-md border border-border p-0.5">
        <button
          onClick={() => { setMode("draw"); }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium",
            mode === "draw" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          )}
        >
          <PenLine className="h-3.5 w-3.5" /> Draw
        </button>
        <button
          onClick={() => { setMode("type"); clear(); }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium",
            mode === "type" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          )}
        >
          <Type className="h-3.5 w-3.5" /> Type
        </button>
      </div>

      {mode === "draw" && (
        <div className="relative">
          <canvas
            ref={canvasRef}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerLeave={end}
            className="h-40 w-full touch-none rounded-md border border-border bg-white"
          />
          <button
            onClick={clear}
            className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-border bg-white/90 px-2 py-1 text-xs text-gray-600"
          >
            <Eraser className="h-3 w-3" /> Clear
          </button>
          <p className="mt-1 text-xs text-muted-foreground">Sign with your finger or mouse.</p>
        </div>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium text-foreground">
          Type your full legal name<span className="ml-0.5 text-destructive">*</span>
        </label>
        <input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. Jennifer Mai Nguyen"
          className="h-11 w-full rounded-md border border-border bg-background px-3 text-base"
        />
      </div>
    </div>
  );
}
