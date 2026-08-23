import { Fragment, type ReactNode } from "react";

/**
 * A deliberately small markdown renderer for assistant answers.
 *
 * The assistant writes one narrow dialect — paragraphs, bullet and numbered
 * lists, bold, inline code, and pipe tables — so this handles exactly that and
 * nothing else. Pulling in a full markdown library (and a sanitiser to go with
 * it) to render six constructs would be the more fragile choice, and building
 * React nodes rather than HTML strings means there is no innerHTML anywhere in
 * the path between the model and the screen.
 */

// ── Inline: **bold**, *italic*, `code` ───────────────────────────────────────

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={key} className="rounded-md bg-surface-sunken px-1 py-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

// ── Tables ───────────────────────────────────────────────────────────────────

const isTableRow = (l: string) => l.trim().startsWith("|") && l.trim().endsWith("|");
const isDivider = (l: string) => /^\s*\|[\s:|-]+\|\s*$/.test(l);

const cells = (line: string) =>
  line.trim().slice(1, -1).split("|").map((c) => c.trim());

/** Right-align a column when its body cells read as figures. */
function numericColumns(rows: string[][]): boolean[] {
  const width = Math.max(...rows.map((r) => r.length));
  return Array.from({ length: width }, (_, c) =>
    rows.every((r) => {
      const v = (r[c] ?? "").replace(/[$,%\s]/g, "");
      return v === "" || v === "—" || v === "-" || !Number.isNaN(Number(v));
    })
  );
}

function Table({ head, body, id }: { head: string[]; body: string[][]; id: string }) {
  const numeric = numericColumns(body);
  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-surface-subtle">
            {head.map((h, i) => (
              <th
                key={`${id}-h-${i}`}
                className={`eyebrow px-2.5 py-2 ${numeric[i] ? "text-right" : "text-left"}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={`${id}-r-${r}`} className="border-b border-border last:border-0">
              {head.map((_, c) => (
                <td
                  key={`${id}-r-${r}-c-${c}`}
                  className={`px-2.5 py-1.5 tnum ${numeric[c] ? "text-right" : "text-left"}`}
                >
                  {inline(row[c] ?? "", `${id}-${r}-${c}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Block parser ─────────────────────────────────────────────────────────────

export function AskMarkdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // Table: a header row, a divider, then body rows.
    if (isTableRow(line) && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const head = cells(line);
      const body: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) {
        body.push(cells(lines[i]));
        i++;
      }
      out.push(<Table key={`t-${i}`} id={`t-${i}`} head={head} body={body} />);
      continue;
    }

    // Heading
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      out.push(
        <p key={`h-${i}`} className="mb-1 mt-3 font-display text-[15px] font-semibold text-foreground first:mt-0">
          {inline(heading[2], `h-${i}`)}
        </p>
      );
      i++;
      continue;
    }

    // Bullet or numbered list
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
        i++;
      }
      const ListTag = ordered ? "ol" : "ul";
      out.push(
        <ListTag
          key={`l-${i}`}
          className={`my-2 space-y-1 pl-4 ${ordered ? "list-decimal" : "list-disc"} marker:text-muted-foreground`}
        >
          {items.map((it, n) => (
            <li key={`l-${i}-${n}`} className="leading-relaxed">{inline(it, `l-${i}-${n}`)}</li>
          ))}
        </ListTag>
      );
      continue;
    }

    // Paragraph — consecutive non-blank, non-structural lines.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isTableRow(lines[i]) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) &&
      !/^#{1,4}\s/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(
      <p key={`p-${i}`} className="my-2 leading-relaxed first:mt-0 last:mb-0">
        {inline(para.join(" "), `p-${i}`)}
      </p>
    );
  }

  return <div className="text-sm text-foreground">{out}</div>;
}
