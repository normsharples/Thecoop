/**
 * Prep labels.
 *
 * Printed from a fresh window rather than a print stylesheet on the app shell —
 * the label needs its own page size and nothing else on the page, and fighting
 * the layout for that is more fragile than handing the browser a clean document.
 *
 * PAGE SIZE — read this before changing it:
 *   `@page { size: 58mm auto }` is INVALID CSS. The `size` grammar takes one or
 *   two <length>s, or the keyword `auto` on its own — never a length paired with
 *   `auto`. An invalid declaration is dropped whole, so the browser silently
 *   falls back to its default paper (A4) and the label prints in the corner of a
 *   sheet. Both dimensions must be explicit lengths.
 *
 *   Height therefore can't be "however tall the content is". So the page
 *   measures the rendered label and writes a matching `@page` height back out
 *   before printing — a tight receipt instead of a long blank feed.
 *
 *   The browser can only REQUEST a paper size. The printer still has to offer
 *   it: pick the receipt printer in the print dialog, and set its driver default
 *   to the roll. Chrome also needs Margins → None and headers/footers off, which
 *   the on-screen hint says.
 *
 * NOTE: coop-clock/src/lib/prepLabel.ts is a copy of this file. Change both.
 */

export type LabelWidth = "58mm" | "80mm" | "a4";

const WIDTH_KEY = "coop.labelWidth";

/** The printer belongs to the device, not the account — remember it locally. */
export function readLabelWidth(): LabelWidth {
  try {
    const v = localStorage.getItem(WIDTH_KEY);
    if (v === "58mm" || v === "80mm" || v === "a4") return v;
  } catch {
    /* private window, blocked storage — fall through */
  }
  return "80mm";
}

export function saveLabelWidth(w: LabelWidth): void {
  try {
    localStorage.setItem(WIDTH_KEY, w);
  } catch {
    /* nothing to do — the picker in the label window still works for this print */
  }
}

export interface PrepLabelData {
  recipeName: string;
  venueName?: string | null;
  madeAt: string | Date;
  useBy?: string | Date | null;
  quantity?: string | null;
  madeBy?: string | null;
  allergens?: string[];
  /** Defaults to the width remembered on this device. */
  width?: LabelWidth;
}

function fmt(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

export function buildPrepLabelHtml(d: PrepLabelData): string {
  const useBy = d.useBy ? fmt(d.useBy) : null;
  const width: LabelWidth = d.width ?? "80mm";

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(d.recipeName)} label</title>
<style>
  /* Overwritten at runtime with the measured height — see sizeAndPrint(). */
  @page { size: 80mm 100mm; margin: 0; }

  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
         color: #000; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  #label { width: var(--label-w, 80mm); padding: 3mm; }
  .name { font-size: 15pt; font-weight: 700; line-height: 1.15; margin: 0 0 1.5mm; }
  .venue { font-size: 8pt; text-transform: uppercase; letter-spacing: .05em; margin: 0 0 2mm; }
  .row { display: flex; justify-content: space-between; gap: 2mm;
         font-size: 9.5pt; padding: 1mm 0; border-top: 0.3mm solid #000; }
  .row span:first-child { font-weight: 600; }
  .useby { margin-top: 2mm; padding: 1.5mm; border: 0.5mm solid #000; text-align: center; }
  .useby .k { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .08em; }
  .useby .v { font-size: 13pt; font-weight: 700; line-height: 1.15; }
  .allergens { margin: 2mm 0 0; font-size: 8.5pt; }

  /* A4 gets a sane margin and keeps the label at its natural width. */
  body.a4 #label { width: 80mm; border: 0.3mm dashed #999; }

  #bar { display: none; }
  @media screen {
    body { padding: 20px; background: #f4f4f5; }
    #label { background: #fff; border: 1px solid #d4d4d8; border-radius: 6px; }
    #bar { display: block; width: 320px; margin-bottom: 16px;
           font-size: 13px; color: #3f3f46; }
    #bar b { display: block; margin-bottom: 6px; font-size: 12px;
             text-transform: uppercase; letter-spacing: .06em; color: #71717a; }
    #bar button { font: inherit; padding: 6px 12px; margin-right: 6px; cursor: pointer;
                  border: 1px solid #d4d4d8; border-radius: 6px; background: #fff; }
    #bar button[aria-pressed="true"] { background: #1e4a8c; border-color: #1e4a8c; color: #fff; }
    #print { margin-top: 10px; background: #1e4a8c; border-color: #1e4a8c; color: #fff; }
    .hint { width: 320px; margin-top: 14px; font-size: 12px; line-height: 1.5; color: #52525b; }
  }
  @media print { #bar, .hint { display: none !important; } }
</style></head>
<body class="${width === "a4" ? "a4" : ""}">
  <div id="bar">
    <b>Label size</b>
    <button data-w="58mm">58 mm</button>
    <button data-w="80mm">80 mm</button>
    <button data-w="a4">A4 sheet</button>
    <button id="print">Print</button>
  </div>

  <div id="label">
    <p class="name">${esc(d.recipeName)}</p>
    ${d.venueName ? `<p class="venue">${esc(d.venueName)}</p>` : ""}
    <div class="row"><span>Made</span><span>${esc(fmt(d.madeAt))}</span></div>
    ${d.quantity ? `<div class="row"><span>Qty</span><span>${esc(d.quantity)}</span></div>` : ""}
    ${d.madeBy ? `<div class="row"><span>By</span><span>${esc(d.madeBy)}</span></div>` : ""}
    <div class="useby"><div class="k">Use by</div><div class="v">${useBy ? esc(useBy) : "—"}</div></div>
    ${
      d.allergens && d.allergens.length
        ? `<p class="allergens"><strong>Allergens:</strong> ${esc(d.allergens.join(", "))}</p>`
        : ""
    }
  </div>

  <p class="hint">
    Pick your receipt printer in the print dialog. In Chrome set <b>Margins&nbsp;→&nbsp;None</b>
    and untick <b>Headers and footers</b>, or the driver will pad it back out to a sheet.
  </p>

<script>
  var WIDTH_KEY = ${JSON.stringify(WIDTH_KEY)};
  var current = ${JSON.stringify(width)};

  function applyWidth(w) {
    current = w;
    document.body.classList.toggle("a4", w === "a4");
    document.documentElement.style.setProperty("--label-w", w === "a4" ? "80mm" : w);
    Array.prototype.forEach.call(document.querySelectorAll("#bar button[data-w]"), function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-w") === w));
    });
    try { localStorage.setItem(WIDTH_KEY, w); } catch (e) {}
  }

  /**
   * Measure the label and write a matching @page back out. Both dimensions must
   * be real lengths — a length paired with 'auto' is invalid and gets dropped,
   * which is what sent these to A4 in the first place.
   */
  function sizePage() {
    var sheet = document.styleSheets[0];
    var label = document.getElementById("label");
    if (current === "a4") {
      sheet.deleteRule(0);
      sheet.insertRule("@page { size: A4; margin: 12mm; }", 0);
      return;
    }
    // Force layout, then px -> mm at the CSS reference 96dpi, plus a little slack.
    var mm = Math.ceil((label.getBoundingClientRect().height * 25.4) / 96) + 3;
    sheet.deleteRule(0);
    sheet.insertRule("@page { size: " + current + " " + mm + "mm; margin: 0; }", 0);
  }

  Array.prototype.forEach.call(document.querySelectorAll("#bar button[data-w]"), function (b) {
    b.addEventListener("click", function () { applyWidth(b.getAttribute("data-w")); });
  });
  document.getElementById("print").addEventListener("click", function () {
    sizePage();
    window.print();
  });

  applyWidth(current);
  window.addEventListener("load", function () {
    sizePage();
    setTimeout(function () { window.print(); }, 60);
  });
</script>
</body></html>`;
}

/** Returns false when the browser blocked the window, so the caller can say so. */
export function printPrepLabel(d: PrepLabelData): boolean {
  const w = window.open("", "_blank", "width=460,height=680");
  if (!w) return false;
  w.document.write(buildPrepLabelHtml({ ...d, width: d.width ?? readLabelWidth() }));
  w.document.close();
  return true;
}
