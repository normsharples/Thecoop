import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Contact,
  Download,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Search,
  Users,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { toCsv, downloadText } from "@/lib/payrun";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useRestaurantScope } from "@/hooks/useRestaurantScope";
import { usePermissions } from "@/hooks/usePermissions";
import type { Profile } from "@/types";

// Only what a contact list needs. Never widen this to employee_sensitive
// (TFN / bank / super) — that table is deliberately not readable in list views.
const CONTACT_COLUMNS = [
  "id",
  "full_name",
  "preferred_name",
  "role",
  "position_title",
  "employment_type",
  "is_rosterable",
  "start_date",
  "phone",
  "email",
  "contact_email",
  "home_restaurant_id",
  "restaurant_access",
  "emergency_name",
  "emergency_relationship",
  "emergency_phone",
  "emergency_phone_alt",
  "address_line1",
  "address_line2",
  "suburb",
  "address_state",
  "postcode",
].join(",");

const ROLE_LABELS: Record<Profile["role"], string> = {
  superadmin: "Superadmin",
  area_manager: "Area manager",
  manager: "Manager",
  shift_supervisor: "Shift supervisor",
  staff: "Staff",
  team_member: "Team member",
};

const EMPLOYMENT_LABELS: Record<string, string> = {
  casual: "Casual",
  part_time: "Part-time",
  full_time: "Full-time",
};

const NO_VENUE = "__none__";

/** A person belongs to a venue via their home store or their access list. */
function venuesOf(p: Profile): string[] {
  const ids = new Set<string>();
  if (p.home_restaurant_id) ids.add(p.home_restaurant_id);
  for (const id of p.restaurant_access ?? []) ids.add(id);
  return [...ids];
}

function bestEmail(p: Profile): string {
  return p.contact_email || p.email || "";
}

function addressOf(p: Profile): string {
  return [p.address_line1, p.address_line2, p.suburb, p.address_state, p.postcode]
    .filter(Boolean)
    .join(", ");
}

function PhoneLink({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground/60">—</span>;
  return (
    <a
      href={`tel:${value.replace(/\s+/g, "")}`}
      className="inline-flex items-center gap-1.5 text-foreground hover:text-primary hover:underline"
    >
      <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      {value}
    </a>
  );
}

function EmailLink({ value }: { value: string }) {
  if (!value) return <span className="text-muted-foreground/60">—</span>;
  return (
    <a
      href={`mailto:${value}`}
      className="inline-flex items-center gap-1.5 truncate text-foreground hover:text-primary hover:underline"
    >
      <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{value}</span>
    </a>
  );
}

function Emergency({ p }: { p: Profile }) {
  if (!p.emergency_name && !p.emergency_phone) {
    return <span className="text-xs text-warning">Not on file</span>;
  }
  return (
    <div className="leading-tight">
      <div className="text-sm text-foreground">
        {p.emergency_name ?? "—"}
        {p.emergency_relationship && (
          <span className="text-muted-foreground"> · {p.emergency_relationship}</span>
        )}
      </div>
      <div className="text-xs">
        <PhoneLink value={p.emergency_phone} />
        {p.emergency_phone_alt && (
          <span className="ml-2">
            <PhoneLink value={p.emergency_phone_alt} />
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Reports → Contacts. Who works where, and how to reach them.
 *
 * Venue selection comes from the header switcher, so picking two venues stacks
 * both lists — one section each, in the switcher's order. Someone who works
 * across venues appears under each of them, which is the point: a manager
 * looking at Torquay wants Torquay's whole list, not a de-duplicated one.
 */
export default function EmployeeContactReport() {
  const { ids, isAll } = useRestaurantScope();
  const { data: restaurants = [] } = useRestaurants();
  const { isSuperadmin } = usePermissions();

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  // RLS (`profiles_select_roster_manager`, migration 048) only returns rows
  // where is_rosterable = true unless you're a superadmin — so for everyone
  // else the list IS rosterable-only whatever the toggle says. Reflect that
  // honestly rather than showing a filter that does nothing.
  const [rosterableOnly, setRosterableOnly] = useState(true);
  const effectiveRosterableOnly = isSuperadmin ? rosterableOnly : true;
  const [showAddresses, setShowAddresses] = useState(false);

  const { data: people = [], isLoading } = useQuery({
    queryKey: ["employee-contacts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select(CONTACT_COLUMNS)
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as unknown as Profile[];
    },
  });

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    return people.filter((p) => {
      if (effectiveRosterableOnly && !p.is_rosterable) return false;
      if (roleFilter && p.role !== roleFilter) return false;
      if (!term) return true;
      return [p.full_name, p.preferred_name, p.phone, bestEmail(p), p.position_title]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [people, search, roleFilter, effectiveRosterableOnly]);

  // One section per venue in view, plus a catch-all so nobody without a venue
  // silently disappears when you're looking at everything.
  const sections = useMemo(() => {
    const byId = new Map(restaurants.map((r) => [r.id, r]));
    const out = ids
      .filter((id) => byId.has(id))
      .map((id) => ({
        id,
        name: byId.get(id)!.name,
        people: matches.filter((p) => venuesOf(p).includes(id)),
      }));

    if (isAll) {
      const orphans = matches.filter((p) => venuesOf(p).length === 0);
      if (orphans.length)
        out.push({ id: NO_VENUE, name: "No venue assigned", people: orphans });
    }
    return out;
  }, [ids, isAll, restaurants, matches]);

  const totalListed = sections.reduce((n, s) => n + s.people.length, 0);

  const exportCsv = () => {
    const headers = [
      "Venue",
      "Name",
      "Preferred name",
      "Role",
      "Position",
      "Employment",
      "Phone",
      "Email",
      "Emergency contact",
      "Emergency relationship",
      "Emergency phone",
      "Emergency phone (alt)",
      "Started",
      ...(showAddresses ? ["Address"] : []),
    ];
    const rows = sections.flatMap((s) =>
      s.people.map((p) => [
        s.name,
        p.full_name,
        p.preferred_name ?? "",
        ROLE_LABELS[p.role] ?? p.role,
        p.position_title ?? "",
        EMPLOYMENT_LABELS[p.employment_type ?? ""] ?? "",
        p.phone ?? "",
        bestEmail(p),
        p.emergency_name ?? "",
        p.emergency_relationship ?? "",
        p.emergency_phone ?? "",
        p.emergency_phone_alt ?? "",
        p.start_date ?? "",
        ...(showAddresses ? [addressOf(p)] : []),
      ])
    );
    downloadText(
      `employee-contacts-${format(new Date(), "yyyy-MM-dd")}.csv`,
      toCsv(headers, rows)
    );
  };

  const scopeLabel = isAll
    ? "all venues"
    : sections
        .filter((s) => s.id !== NO_VENUE)
        .map((s) => s.name)
        .join(" + ");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Contact className="h-6 w-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Employee contact information
            </h2>
            <p className="text-sm text-muted-foreground">
              Showing {scopeLabel} · {totalListed}{" "}
              {totalListed === 1 ? "person" : "people"}. Pick more venues in the header
              switcher to stack their lists.
            </p>
            {!isSuperadmin && (
              <p className="mt-0.5 text-xs text-muted-foreground/80">
                Your access covers rosterable team members — people not flagged for
                rostering won't appear here.
              </p>
            )}
          </div>
        </div>
        <button
          onClick={exportCsv}
          disabled={totalListed === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
        >
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, phone, email…"
            className="w-48 rounded-lg border border-border bg-card py-2 pl-8 pr-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 sm:w-56"
          />
        </div>

        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="rounded-lg border border-border bg-card px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value="">All roles</option>
          {(Object.keys(ROLE_LABELS) as Profile["role"][]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>

        <label
          className={cn(
            "inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground",
            isSuperadmin ? "cursor-pointer" : "cursor-not-allowed opacity-60"
          )}
          title={
            isSuperadmin
              ? undefined
              : "Your access covers rosterable team members only"
          }
        >
          <input
            type="checkbox"
            checked={effectiveRosterableOnly}
            disabled={!isSuperadmin}
            onChange={(e) => setRosterableOnly(e.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          Rosterable only
        </label>

        {isSuperadmin && (
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={showAddresses}
              onChange={(e) => setShowAddresses(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
            Show addresses
          </label>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading contacts…
        </div>
      ) : sections.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No venues in view. Choose one from the header switcher.
        </div>
      ) : (
        sections.map((section) => (
          <section key={section.id} className="space-y-2">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">{section.name}</h3>
              <span className="text-xs text-muted-foreground">
                {section.people.length} {section.people.length === 1 ? "person" : "people"}
              </span>
            </div>

            {section.people.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
                {search || roleFilter || (isSuperadmin && rosterableOnly)
                  ? "Nobody here matches the current filters."
                  : "Nobody is assigned to this venue yet."}
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-border bg-muted/30 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        <th className="px-3 py-2">Name</th>
                        <th className="px-3 py-2">Phone</th>
                        <th className="px-3 py-2">Email</th>
                        <th className="px-3 py-2">Emergency contact</th>
                        {showAddresses && <th className="px-3 py-2">Address</th>}
                        <th className="px-3 py-2">Started</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {section.people.map((p) => (
                        <tr key={p.id} className="hover:bg-muted/10 align-top">
                          <td className="px-3 py-2">
                            <div className="text-sm font-medium text-foreground">
                              {p.full_name}
                              {p.preferred_name && p.preferred_name !== p.full_name && (
                                <span className="font-normal text-muted-foreground">
                                  {" "}
                                  ({p.preferred_name})
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {[
                                p.position_title,
                                EMPLOYMENT_LABELS[p.employment_type ?? ""],
                                ROLE_LABELS[p.role],
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                              {!p.is_rosterable && (
                                <span className="ml-1 text-muted-foreground/70">
                                  · not rostered
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-sm">
                            <PhoneLink value={p.phone} />
                          </td>
                          <td className="max-w-[220px] px-3 py-2 text-sm">
                            <EmailLink value={bestEmail(p)} />
                          </td>
                          <td className="px-3 py-2">
                            <Emergency p={p} />
                          </td>
                          {showAddresses && (
                            <td className="max-w-[220px] px-3 py-2 text-sm text-muted-foreground">
                              {addressOf(p) || "—"}
                            </td>
                          )}
                          <td className="whitespace-nowrap px-3 py-2 text-sm text-muted-foreground">
                            {p.start_date ? format(parseISO(p.start_date), "d MMM yyyy") : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="space-y-2 md:hidden">
                  {section.people.map((p) => (
                    <div
                      key={p.id}
                      className={cn("rounded-xl border border-border bg-card p-3 space-y-1.5")}
                    >
                      <div>
                        <div className="text-sm font-medium text-foreground">{p.full_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {[
                            p.position_title,
                            EMPLOYMENT_LABELS[p.employment_type ?? ""],
                            ROLE_LABELS[p.role],
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                      <div className="text-sm">
                        <PhoneLink value={p.phone} />
                      </div>
                      <div className="text-sm">
                        <EmailLink value={bestEmail(p)} />
                      </div>
                      <div className="border-t border-border pt-1.5">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Emergency
                        </div>
                        <Emergency p={p} />
                      </div>
                      {showAddresses && addressOf(p) && (
                        <div className="border-t border-border pt-1.5 text-xs text-muted-foreground">
                          {addressOf(p)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        ))
      )}
    </div>
  );
}
