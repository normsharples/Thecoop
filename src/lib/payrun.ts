import type { GrossLineKey } from "@/lib/award";

// Earnings-rate names written into the Xero timesheet CSV `type` column. These
// must match the Earnings Rate / Pay Item names configured in Xero Payroll —
// rename here (or in Xero) if the operator's pay items differ.
export const EARNINGS_RATE: Record<GrossLineKey, string> = {
  ordinary: "Ordinary Hours",
  evening: "Evening",
  night: "Night",
  saturday: "Saturday",
  sunday: "Sunday",
  public_holiday: "Public Holiday",
  ot_first2: "Overtime x1.5",
  ot_after: "Overtime x2",
};

/** Split a full name into first / last for Xero (matches employees by name). */
export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function csvCell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(","));
  return lines.join("\r\n");
}

/** Trigger a client-side download of text content. */
export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
