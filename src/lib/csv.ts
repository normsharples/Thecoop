/**
 * Minimal RFC-4180 CSV reader. Deliberately dependency-free — an import that
 * runs a handful of times a year doesn't justify a new package in the bundle.
 * Handles quoted fields, embedded commas/newlines, escaped quotes and CRLF.
 */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // Strip a UTF-8 BOM — Deputy's export has one, and it corrupts the first header.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }

  row.push(field);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

/** Header row + data rows -> objects keyed by the (trimmed) header. */
export function toObjects(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => (o[h] = (r[i] ?? "").trim()));
    return o;
  });
}

/**
 * Find the first header matching any alias, case- and punctuation-insensitively.
 * Deputy's exporter and its API disagree on casing and spacing ("StartTime" vs
 * "Start Time" vs "start_time"), so compare on a squashed key.
 */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function findHeader(headers: string[], aliases: string[]): string | null {
  const want = aliases.map(squash);
  for (const h of headers) {
    if (want.includes(squash(h))) return h;
  }
  return null;
}
