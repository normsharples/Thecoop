import { format, parseISO, differenceInYears } from "date-fns";
import {
  DEFAULT_AWARD,
  LEVEL_LABELS,
  effectiveHourlyRate,
  juniorPercent,
  type AwardConfig,
  type AwardLevel,
} from "./award";
import type { Profile, Restaurant, CompanySettings, ContractTemplate } from "@/types";

/**
 * Contract templates are HTML with {{token}} placeholders. Rendering is a plain
 * string substitution — no logic, no conditionals — so a template can never do
 * anything surprising. Unresolved tokens are reported, not silently blanked,
 * because a contract with a hole in it must never be issued.
 */

export interface TokenDef {
  token: string;
  label: string;
  group: string;
  example: string;
}

export const TOKENS: TokenDef[] = [
  // Employee
  { token: "employee.full_name",      label: "Name (as used in the app)", group: "Employee", example: "Jenny Nguyen" },
  { token: "employee.legal_name",     label: "Full legal name",           group: "Employee", example: "Jennifer Mai Nguyen" },
  { token: "employee.first_name",     label: "Legal first name",          group: "Employee", example: "Jennifer" },
  { token: "employee.last_name",      label: "Legal last name",           group: "Employee", example: "Nguyen" },
  { token: "employee.preferred_name", label: "Goes by",                   group: "Employee", example: "Jenny" },
  { token: "employee.dob",            label: "Date of birth",             group: "Employee", example: "4 March 2007" },
  { token: "employee.age",            label: "Age at start date",         group: "Employee", example: "18" },
  { token: "employee.address",        label: "Residential address",       group: "Employee", example: "12 Pako St, Geelong West VIC 3218" },
  { token: "employee.email",          label: "Email",                     group: "Employee", example: "jenny@example.com" },
  { token: "employee.phone",          label: "Mobile",                    group: "Employee", example: "0400 000 000" },
  // Employment
  { token: "employment.position",     label: "Position title",            group: "Employment", example: "Crew Member" },
  { token: "employment.type",         label: "Employment type",           group: "Employment", example: "Casual" },
  { token: "employment.start_date",   label: "Start date",                group: "Employment", example: "1 September 2026" },
  { token: "employment.probation",    label: "Probation period",          group: "Employment", example: "6 months" },
  { token: "employment.hours",        label: "Contracted hours per week", group: "Employment", example: "20" },
  { token: "employment.pay_type",     label: "Hourly or salary",          group: "Employment", example: "Hourly" },
  { token: "employment.pay_rate",     label: "Base hourly rate",          group: "Employment", example: "$24.34" },
  { token: "employment.salary",       label: "Annual salary",             group: "Employment", example: "$68,000" },
  { token: "employment.pay_frequency",label: "Pay frequency",             group: "Employment", example: "Weekly" },
  // Award
  { token: "award.name",              label: "Award name",                group: "Award", example: "Fast Food Industry Award 2010" },
  { token: "award.code",              label: "Award code",                group: "Award", example: "MA000003" },
  { token: "award.level",             label: "Award level",               group: "Award", example: "Level 1" },
  { token: "award.classification",    label: "Full classification",       group: "Award", example: "Fast Food Employee Level 1" },
  { token: "award.junior_percent",    label: "Junior rate %",             group: "Award", example: "70%" },
  // Venue
  { token: "restaurant.name",         label: "Store name",                group: "Venue", example: "Pollo Geelong West" },
  { token: "restaurant.address",      label: "Store address",             group: "Venue", example: "173 Pakington St, Geelong West VIC" },
  { token: "restaurant.state",        label: "Store state",               group: "Venue", example: "VIC" },
  // Company
  { token: "company.legal_name",      label: "Employer legal name",       group: "Company", example: "Pollo Rotisserie Pty Ltd" },
  { token: "company.trading_name",    label: "Trading name",              group: "Company", example: "Pollo Rotisserie" },
  { token: "company.abn",             label: "ABN",                       group: "Company", example: "00 000 000 000" },
  { token: "company.address",         label: "Registered address",        group: "Company", example: "173 Pakington St, Geelong West VIC" },
  { token: "company.signatory_name",  label: "Employer signatory",        group: "Company", example: "Norm Sharples" },
  { token: "company.signatory_title", label: "Signatory title",           group: "Company", example: "Director" },
  // Other
  { token: "today",                   label: "Today's date",              group: "Other", example: "22 August 2026" },
  { token: "signature.block",         label: "Signature block",           group: "Other", example: "(signature panel)" },
];

export const SIGNATURE_TOKEN = "signature.block";

/**
 * Where each token's value is actually maintained.
 *
 * Without this the "missing fields" warning just names tokens, and pointed
 * everyone at the Details tab — but pay rate and award level live in
 * Team → Payroll, so the message sent people to the wrong screen.
 */
export const TOKEN_SOURCES: Record<string, string> = {
  "employee.full_name": "Team → Members",
  "employee.legal_name": "Details tab",
  "employee.first_name": "Details tab",
  "employee.last_name": "Details tab",
  "employee.preferred_name": "Details tab",
  "employee.dob": "Details tab",
  "employee.age": "Details tab (date of birth)",
  "employee.address": "Details tab",
  "employee.email": "Details tab",
  "employee.phone": "Details tab",

  "employment.position": "Details tab → Employment terms",
  "employment.start_date": "Details tab → Employment terms",
  "employment.probation": "Details tab → Employment terms",
  "employment.type": "Details tab → Employment terms",
  "employment.hours": "Details tab → Employment terms (contracted hours)",
  "employment.pay_type": "Details tab → Employment terms",
  "employment.pay_rate": "Details tab → Employment terms (award level, or a manual rate)",
  "employment.salary": "Details tab → Employment terms (annual salary)",
  "employment.pay_frequency": "Built in",

  "award.name": "Built in",
  "award.code": "Built in",
  "award.level": "Details tab → Employment terms (award level)",
  "award.classification": "Details tab → Employment terms (award level)",
  "award.junior_percent": "Details tab (date of birth)",

  "restaurant.name": "Settings → Venues",
  "restaurant.address": "Settings → Venues",
  "restaurant.state": "Settings → Venues",

  "company.legal_name": "Team → Contracts → Company & signature",
  "company.trading_name": "Team → Contracts → Company & signature",
  "company.abn": "Team → Contracts → Company & signature",
  "company.address": "Team → Contracts → Company & signature",
  "company.signatory_name": "Team → Contracts → Company & signature",
  "company.signatory_title": "Team → Contracts → Company & signature",
};

/** Group missing tokens by the screen that fixes them. */
export function groupMissingBySource(
  missing: string[]
): { source: string; labels: string[] }[] {
  const bySource = new Map<string, string[]>();
  missing.forEach((token) => {
    const source = TOKEN_SOURCES[token] ?? "Details tab";
    const label = TOKENS.find((t) => t.token === token)?.label ?? token;
    const list = bySource.get(source) ?? [];
    list.push(label);
    bySource.set(source, list);
  });
  return [...bySource.entries()].map(([source, labels]) => ({ source, labels }));
}

export interface TokenContext {
  profile: Partial<Profile>;
  restaurant?: Pick<Restaurant, "name" | "address" | "state"> | null;
  company: CompanySettings;
  award?: AwardConfig;
}

const EMPLOYMENT_LABELS: Record<string, string> = {
  casual: "Casual",
  part_time: "Part-time",
  full_time: "Full-time",
};

function money(n?: number | null) {
  if (n == null) return "";
  return `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d?: string | null) {
  if (!d) return "";
  try {
    return format(parseISO(d), "d MMMM yyyy");
  } catch {
    return d;
  }
}

/** Build every token's value for one employee. */
export function buildTokenValues(ctx: TokenContext): Record<string, string> {
  const { profile: p, restaurant: r, company: c } = ctx;
  const cfg = ctx.award ?? DEFAULT_AWARD;
  const onDate = p.start_date || new Date().toISOString().slice(0, 10);

  const legalName = [p.legal_first_name, p.legal_middle_name, p.legal_last_name]
    .filter(Boolean)
    .join(" ");
  const address = [
    [p.address_line2, p.address_line1].filter(Boolean).join(", "),
    p.suburb,
    [p.address_state, p.postcode].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  const eff = effectiveHourlyRate(
    { award_level: p.award_level, date_of_birth: p.date_of_birth, base_pay_rate: p.base_pay_rate },
    onDate,
    cfg
  );
  const jp = p.date_of_birth ? juniorPercent(p.date_of_birth, onDate, cfg) : null;
  const level = (p.award_level ?? null) as AwardLevel | null;

  return {
    "employee.full_name": p.full_name ?? "",
    "employee.legal_name": legalName || p.full_name || "",
    "employee.first_name": p.legal_first_name ?? (p.full_name ?? "").split(" ")[0] ?? "",
    "employee.last_name": p.legal_last_name ?? (p.full_name ?? "").split(" ").slice(1).join(" "),
    "employee.preferred_name": p.preferred_name || p.full_name || "",
    "employee.dob": fmtDate(p.date_of_birth),
    "employee.age": p.date_of_birth
      ? String(differenceInYears(parseISO(onDate), parseISO(p.date_of_birth)))
      : "",
    "employee.address": address,
    "employee.email": p.contact_email ?? "",
    "employee.phone": p.phone ?? "",

    "employment.position": p.position_title ?? "",
    "employment.type": EMPLOYMENT_LABELS[p.employment_type ?? ""] ?? "",
    "employment.start_date": fmtDate(p.start_date),
    "employment.probation": p.probation_weeks ? `${p.probation_weeks} weeks` : "",
    "employment.hours": p.contracted_hours != null ? String(p.contracted_hours) : "",
    "employment.pay_type": p.pay_type === "salary" ? "Salary" : "Hourly",
    "employment.pay_rate": money(eff.rate),
    "employment.salary": p.salary_annual != null ? money(p.salary_annual) : "",
    "employment.pay_frequency": "Weekly",

    "award.name": "Fast Food Industry Award 2010",
    "award.code": cfg.code,
    "award.level": level ? LEVEL_LABELS[level] ?? `Level ${level}` : "",
    "award.classification": level ? `Fast Food Employee ${LEVEL_LABELS[level] ?? level}` : "",
    // Never blank: an adult is simply 100%. Returning "" here made every
    // over-21 employee fail the "missing tokens" check and block issuing.
    "award.junior_percent": jp != null ? `${jp}%` : "100%",

    "restaurant.name": r?.name ?? "",
    "restaurant.address": r?.address ?? "",
    "restaurant.state": r?.state ?? "",

    "company.legal_name": c.legal_name,
    "company.trading_name": c.trading_name,
    "company.abn": c.abn,
    "company.address": c.address,
    "company.signatory_name": c.signatory_name,
    "company.signatory_title": c.signatory_title,

    today: fmtDate(new Date().toISOString().slice(0, 10)),
  };
}

/** Sample values for the template editor's preview pane. */
export function sampleTokenValues(): Record<string, string> {
  const out: Record<string, string> = {};
  TOKENS.forEach((t) => { out[t.token] = t.example; });
  return out;
}

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export interface RenderResult {
  html: string;
  missing: string[];   // tokens with no value
  unknown: string[];   // tokens we don't recognise at all
}

export function renderTemplate(
  body: string,
  values: Record<string, string>,
  opts: { signatureHtml?: string } = {}
): RenderResult {
  const known = new Set(TOKENS.map((t) => t.token));
  const missing = new Set<string>();
  const unknown = new Set<string>();

  const html = body.replace(TOKEN_RE, (_m, tokenRaw: string) => {
    const token = tokenRaw.trim();
    if (token === SIGNATURE_TOKEN) return opts.signatureHtml ?? "";
    if (!known.has(token)) { unknown.add(token); return `{{${token}}}`; }
    const v = values[token];
    if (v == null || v === "") { missing.add(token); return `<span class="contract-missing">[${token}]</span>`; }
    return escapeHtml(v);
  });

  return { html, missing: [...missing], unknown: [...unknown] };
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Which template applies: most specific match wins. */
export function pickTemplate(
  templates: ContractTemplate[],
  opts: { employmentType?: string | null; restaurantId?: string | null; kind?: "contract" | "variation" }
): ContractTemplate | null {
  const kind = opts.kind ?? "contract";
  const candidates = templates.filter((t) => t.active && t.kind === kind);
  const score = (t: ContractTemplate) => {
    if (t.employment_type && t.employment_type !== opts.employmentType) return -1;
    if (t.restaurant_id && t.restaurant_id !== opts.restaurantId) return -1;
    return (t.employment_type ? 2 : 0) + (t.restaurant_id ? 1 : 0);
  };
  let best: ContractTemplate | null = null;
  let bestScore = -1;
  for (const t of candidates) {
    const s = score(t);
    if (s > bestScore) { best = t; bestScore = s; }
  }
  return bestScore < 0 ? null : best;
}

/** Print stylesheet shared by the preview, the signed copy and the PDF print. */
export const CONTRACT_CSS = `
  .contract-doc { font-family: Georgia, "Times New Roman", serif; font-size: 12pt; line-height: 1.55; color: #111; max-width: 800px; margin: 0 auto; }
  .contract-doc h1 { font-size: 19pt; margin: 0 0 4pt; }
  .contract-doc h2 { font-size: 14pt; margin: 20pt 0 6pt; border-bottom: 1px solid #ddd; padding-bottom: 3pt; }
  .contract-doc h3 { font-size: 12.5pt; margin: 14pt 0 4pt; }
  .contract-doc p, .contract-doc li { margin: 0 0 8pt; }
  .contract-doc ul, .contract-doc ol { padding-left: 20pt; }
  .contract-doc table { border-collapse: collapse; width: 100%; margin: 8pt 0; }
  .contract-doc td, .contract-doc th { border: 1px solid #ccc; padding: 5pt 7pt; text-align: left; font-size: 11pt; }
  .contract-doc .contract-missing { background: #ffe8e8; color: #b40000; padding: 0 3px; border-radius: 3px; }
  .contract-doc .sig-grid { display: flex; gap: 32pt; margin-top: 18pt; flex-wrap: wrap; }
  .contract-doc .sig-box { flex: 1 1 240px; }
  .contract-doc .sig-line { border-bottom: 1px solid #333; height: 46px; margin-bottom: 4pt; display: flex; align-items: flex-end; }
  .contract-doc .sig-line img { max-height: 44px; }
  .contract-doc .sig-meta { font-size: 9pt; color: #555; }
  @media print { .contract-doc { max-width: none; } }
`;

/** Open a print window for a rendered contract (browser makes the PDF). */
export function printContract(html: string, title: string) {
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) {
    throw new Error("Pop-ups are blocked — allow them for this site to print.");
  }
  w.document.write(
    `<!doctype html><html><head><title>${title}</title><style>${CONTRACT_CSS}
     body{margin:24px;background:#fff;}</style></head>
     <body><div class="contract-doc">${html}</div>
     <script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>
     </body></html>`
  );
  w.document.close();
}

/**
 * Clean HTML pasted out of Word / Google Docs / a PDF viewer.
 *
 * Pasting from Word carries the document's real structure (headings, bold,
 * lists, tables) on the clipboard, so this gets us the same result a .docx
 * importer would — without shipping a docx parser. It strips Word's mso-*
 * noise, inline styles, classes, ids, comments, empty spans and scripts.
 */
export function cleanPastedHtml(raw: string): string {
  if (!raw) return "";
  const doc = new DOMParser().parseFromString(raw, "text/html");

  // Word wraps everything in conditional comments and <o:p> junk.
  doc.querySelectorAll("script, style, meta, link, o\\:p").forEach((n) => n.remove());

  const walk = (node: Element) => {
    [...node.children].forEach(walk);
    node.removeAttribute("style");
    node.removeAttribute("class");
    node.removeAttribute("id");
    node.removeAttribute("lang");
    node.removeAttribute("dir");
    [...node.attributes].forEach((a) => {
      if (a.name.startsWith("data-") || a.name.startsWith("on") || a.name.startsWith("xmlns")) {
        node.removeAttribute(a.name);
      }
    });
    // Unwrap spans and font tags that no longer carry anything.
    if (["SPAN", "FONT"].includes(node.tagName)) {
      const parent = node.parentNode;
      if (parent) {
        while (node.firstChild) parent.insertBefore(node.firstChild, node);
        parent.removeChild(node);
      }
    }
  };
  [...doc.body.children].forEach(walk);

  return doc.body.innerHTML
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<p>(\s|&nbsp;)*<\/p>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The signature panel injected wherever {{signature.block}} appears. */
export function signatureBlockHtml(opts: {
  employeeName?: string | null;
  employeeSignature?: string | null;
  signedAt?: string | null;
  employerName?: string | null;
  employerTitle?: string | null;
  employerSignature?: string | null;
  employerSignedAt?: string | null;
  ip?: string | null;
  contentHash?: string | null;
}): string {
  const img = (src?: string | null) =>
    src ? `<img src="${src}" alt="signature" />` : "";
  const when = (d?: string | null) => (d ? format(new Date(d), "d MMMM yyyy, h:mma") : "");
  return `
  <div class="sig-grid">
    <div class="sig-box">
      <div class="sig-line">${img(opts.employeeSignature)}</div>
      <div><strong>${opts.employeeName ?? ""}</strong></div>
      <div class="sig-meta">Employee${opts.signedAt ? ` — signed ${when(opts.signedAt)}` : ""}</div>
    </div>
    <div class="sig-box">
      <div class="sig-line">${img(opts.employerSignature)}</div>
      <div><strong>${opts.employerName ?? ""}</strong></div>
      <div class="sig-meta">${opts.employerTitle ?? ""}${
        opts.employerSignedAt ? ` — ${when(opts.employerSignedAt)}` : ""
      }</div>
    </div>
  </div>
  ${
    opts.signedAt
      ? `<p class="sig-meta">Signed electronically${opts.ip ? ` from ${opts.ip}` : ""}${
          opts.contentHash ? `. Document fingerprint ${opts.contentHash.slice(0, 16)}…` : ""
        }</p>`
      : ""
  }`;
}

/**
 * Where the signature panel goes inside the stored snapshot.
 *
 * body_html is rendered ONCE at issue time and never changes — that is the
 * record of what the employee agreed to, and what content_hash is taken over.
 * The signature itself is stored in columns and injected at display time, so
 * signing can never alter the agreed text.
 */
export const SIG_MARKER = "<!--SIGBLOCK-->";

export function withSignature(
  bodyHtml: string,
  opts: Parameters<typeof signatureBlockHtml>[0]
): string {
  const panel = signatureBlockHtml(opts);
  return bodyHtml.includes(SIG_MARKER)
    ? bodyHtml.replace(SIG_MARKER, panel)
    : bodyHtml + panel;
}
