import qrcode from "qrcode-generator";

/**
 * QR codes as inline SVG.
 *
 * Used for the onboarding invite: a manager holds their screen up and the new
 * hire points their phone at it, so nothing has to be emailed or typed. SVG
 * rather than canvas so it prints at any size and needs no ref or effect.
 *
 * Error-correction level M is the usual choice for a URL on a screen — it
 * tolerates a smudged or partly covered code without inflating the module
 * count the way H does.
 */
export function qrSvgPath(text: string): { path: string; size: number } {
  const qr = qrcode(0, "M"); // 0 = pick the smallest version that fits
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const parts: string[] = [];

  // One <path> of 1×1 squares beats thousands of <rect>s: the DOM stays small
  // and the whole code scales with the viewBox.
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) parts.push(`M${col} ${row}h1v1h-1z`);
    }
  }

  return { path: parts.join(""), size: count };
}
