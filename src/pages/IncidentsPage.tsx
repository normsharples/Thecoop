import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  PlusCircle,
  ChevronLeft,
  Trash2,
  Eye,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useSelectedRestaurant } from "@/hooks/useSelectedRestaurant";
import { useRestaurants } from "@/hooks/useRestaurants";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// ─── Types ───────────────────────────────────────────────────────────────────

type View = "list" | "new" | "detail";

interface Party {
  name: string;
  contact: string;
}

interface Incident {
  id: string;
  restaurant_id: string;
  title: string;
  description: string | null;
  incident_type: string;
  severity: string;
  incident_date: string;
  reported_by: string | null;
  status: string;
  resolution: string | null;
  created_at: string;
  report_date: string | null;
  report_prepared_by: string | null;
  location: string | null;
  parties_involved: Party[];
  incident_detail: string | null;
  immediate_actions: string | null;
  conclusions: string | null;
  cause: string | null;
  corrective_actions_detail: string | null;
  prevention_steps: string | null;
  follow_up: string | null;
  reporter_name: string | null;
  supervisor_name: string | null;
  reporter_signature: string | null;
  supervisor_signature: string | null;
  date_signed_reporter: string | null;
  date_signed_supervisor: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const INCIDENT_TYPES: { value: string; label: string }[] = [
  { value: "accident", label: "Accident" },
  { value: "injury", label: "Injury" },
  { value: "equipment", label: "Equipment Failure" },
  { value: "customer_complaint", label: "Customer Complaint" },
  { value: "food_safety", label: "Food Safety" },
  { value: "theft", label: "Theft" },
  { value: "other", label: "Other" },
];

const STATUS_COLORS: Record<string, string> = {
  open: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  investigating: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  resolved: "bg-green-500/10 text-green-500 border-green-500/20",
  closed: "bg-muted text-muted-foreground border-border",
};

// ─── Schema ──────────────────────────────────────────────────────────────────

const incidentSchema = z.object({
  report_date: z.string().min(1, "Required"),
  report_prepared_by: z.string().min(1, "Required"),
  incident_date: z.string().min(1, "Required"),
  location: z.string().optional(),
  incident_type: z.string().min(1, "Select a type"),
  description: z.string().optional(),
  party1_name: z.string().optional(),
  party1_contact: z.string().optional(),
  party2_name: z.string().optional(),
  party2_contact: z.string().optional(),
  party3_name: z.string().optional(),
  party3_contact: z.string().optional(),
  incident_detail: z.string().optional(),
  immediate_actions: z.string().optional(),
  conclusions: z.string().optional(),
  cause: z.string().optional(),
  corrective_actions_detail: z.string().optional(),
  prevention_steps: z.string().optional(),
  follow_up: z.string().optional(),
  reporter_name: z.string().optional(),
  supervisor_name: z.string().optional(),
  reporter_signature: z.string().optional(),
  supervisor_signature: z.string().optional(),
  date_signed_reporter: z.string().optional(),
  date_signed_supervisor: z.string().optional(),
});

type FormValues = z.infer<typeof incidentSchema>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function typeLabel(type: string) {
  return INCIDENT_TYPES.find((t) => t.value === type)?.label ?? type;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b-2 border-primary pb-1 mb-4">
      <h3 className="text-base font-semibold text-primary">{children}</h3>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground min-h-[1.25rem]">{value || "—"}</p>
    </div>
  );
}

function TextBlock({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 min-h-[80px]">
        <p className="text-sm text-foreground whitespace-pre-wrap">{value || ""}</p>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function IncidentsPage() {
  const [view, setView] = useState<View>("list");
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);

  const { profile } = useAuth();
  const { isSuperadmin } = usePermissions();
  const { selectedRestaurantId } = useSelectedRestaurant();
  const { data: restaurants = [] } = useRestaurants();
  const queryClient = useQueryClient();

  const restaurant = restaurants.find((r) => r.id === selectedRestaurantId);

  const { data: incidents = [], isLoading } = useQuery<Incident[]>({
    queryKey: ["incidents", selectedRestaurantId],
    queryFn: async () => {
      if (!selectedRestaurantId) return [];
      const { data, error } = await supabase
        .from("incidents")
        .select("*")
        .eq("restaurant_id", selectedRestaurantId)
        .order("incident_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Incident[];
    },
    enabled: !!selectedRestaurantId,
  });

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } =
    useForm<FormValues>({
      resolver: zodResolver(incidentSchema),
      defaultValues: {
        report_date: format(new Date(), "yyyy-MM-dd"),
        incident_date: format(new Date(), "yyyy-MM-dd"),
        incident_type: "",
      },
    });

  const { mutate: saveIncident, isPending } = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!selectedRestaurantId || !profile) throw new Error("Not authenticated");

      const parties: Party[] = [
        { name: values.party1_name ?? "", contact: values.party1_contact ?? "" },
        { name: values.party2_name ?? "", contact: values.party2_contact ?? "" },
        { name: values.party3_name ?? "", contact: values.party3_contact ?? "" },
      ].filter((p) => p.name || p.contact);

      const typeLabel = INCIDENT_TYPES.find((t) => t.value === values.incident_type)?.label ?? values.incident_type;
      const title = `${typeLabel} — ${format(new Date(values.incident_date + "T00:00:00"), "d MMM yyyy")}`;

      const { error } = await supabase.from("incidents").insert({
        restaurant_id: selectedRestaurantId,
        title,
        description: values.description || null,
        incident_type: values.incident_type,
        severity: "medium",
        incident_date: values.incident_date,
        reported_by: profile.id,
        status: "open",
        report_date: values.report_date || null,
        report_prepared_by: values.report_prepared_by || null,
        location: values.location || null,
        parties_involved: parties,
        incident_detail: values.incident_detail || null,
        immediate_actions: values.immediate_actions || null,
        conclusions: values.conclusions || null,
        cause: values.cause || null,
        corrective_actions_detail: values.corrective_actions_detail || null,
        prevention_steps: values.prevention_steps || null,
        follow_up: values.follow_up || null,
        reporter_name: values.reporter_name || null,
        supervisor_name: values.supervisor_name || null,
        reporter_signature: values.reporter_signature || null,
        supervisor_signature: values.supervisor_signature || null,
        date_signed_reporter: values.date_signed_reporter || null,
        date_signed_supervisor: values.date_signed_supervisor || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Incident report saved");
      reset();
      queryClient.invalidateQueries({ queryKey: ["incidents", selectedRestaurantId] });
      setView("list");
    },
    onError: (err) => {
      toast.error("Failed to save: " + (err as Error).message);
    },
  });

  const { mutate: deleteIncident } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("incidents").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Report deleted");
      queryClient.invalidateQueries({ queryKey: ["incidents", selectedRestaurantId] });
      if (view === "detail") setView("list");
    },
    onError: (err) => {
      toast.error("Failed to delete: " + (err as Error).message);
    },
  });

  const selectedType = watch("incident_type");

  if (!selectedRestaurantId) {
    return (
      <div className="rounded-xl border border-border bg-card p-12 text-center">
        <p className="text-sm text-muted-foreground">Select a restaurant to continue.</p>
      </div>
    );
  }

  // ── Detail view ─────────────────────────────────────────────────────────────
  if (view === "detail" && selectedIncident) {
    const inc = selectedIncident;
    return (
      <div className="space-y-6 max-w-3xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setView("list")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to reports
          </button>
          {isSuperadmin && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this incident report?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes the report for{" "}
                    <span className="font-medium text-foreground">{inc.title}</span>. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteIncident(inc.id)}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-6 space-y-8">
          {/* Title */}
          <div className="flex items-start justify-between border-b border-border pb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-bold text-foreground">Incident Report</h2>
              </div>
              <p className="text-sm text-muted-foreground">{restaurant?.name}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={cn("border text-xs capitalize", STATUS_COLORS[inc.status])}>
                {inc.status}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {typeLabel(inc.incident_type)}
              </Badge>
            </div>
          </div>

          {/* Report Info */}
          <section>
            <SectionHeader>Report Information</SectionHeader>
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              <FieldRow label="Date of Report" value={inc.report_date ? format(new Date(inc.report_date + "T00:00:00"), "d MMM yyyy") : null} />
              <FieldRow label="Report Prepared By" value={inc.report_prepared_by} />
              <FieldRow label="Date of Incident" value={format(new Date(inc.incident_date), "d MMM yyyy")} />
              <FieldRow label="Location of Incident" value={inc.location} />
            </div>
            <div className="mt-4">
              <p className="text-xs text-muted-foreground mb-1">Type of Incident</p>
              <p className="text-sm font-medium text-foreground">{typeLabel(inc.incident_type)}</p>
            </div>
            {inc.description && (
              <div className="mt-4">
                <TextBlock label="Incident Description" value={inc.description} />
              </div>
            )}
          </section>

          {/* Parties */}
          {inc.parties_involved?.length > 0 && (
            <section>
              <SectionHeader>Parties Involved</SectionHeader>
              <div className="space-y-3">
                {inc.parties_involved.map((party, i) => (
                  <div key={i} className="grid grid-cols-2 gap-x-8">
                    <FieldRow label={`Party ${i + 1} Name`} value={party.name} />
                    <FieldRow label={`Party ${i + 1} Contact`} value={party.contact} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Incident Details */}
          <section>
            <SectionHeader>Incident Details</SectionHeader>
            <div className="space-y-4">
              {inc.incident_detail && <TextBlock label="Describe the incident in detail" value={inc.incident_detail} />}
              {inc.immediate_actions && <TextBlock label="Summarize the immediate actions taken" value={inc.immediate_actions} />}
            </div>
          </section>

          {/* Investigation */}
          {(inc.conclusions || inc.cause) && (
            <section>
              <SectionHeader>Investigation and Findings</SectionHeader>
              <div className="space-y-4">
                {inc.conclusions && <TextBlock label="Discuss any immediate conclusions drawn from the incident" value={inc.conclusions} />}
                {inc.cause && <TextBlock label="Identify the cause of the incident" value={inc.cause} />}
              </div>
            </section>
          )}

          {/* Corrective Actions */}
          {(inc.corrective_actions_detail || inc.prevention_steps) && (
            <section>
              <SectionHeader>Corrective Actions</SectionHeader>
              <div className="space-y-4">
                {inc.corrective_actions_detail && <TextBlock label="Corrective actions taken" value={inc.corrective_actions_detail} />}
                {inc.prevention_steps && <TextBlock label="Outline steps for preventing a recurrence of the incident" value={inc.prevention_steps} />}
              </div>
            </section>
          )}

          {/* Conclusion */}
          {inc.follow_up && (
            <section>
              <SectionHeader>Conclusion</SectionHeader>
              <TextBlock label="Indicate whether there will be a follow-up action" value={inc.follow_up} />
            </section>
          )}

          {/* Signatures */}
          {(inc.reporter_name || inc.supervisor_name) && (
            <section>
              <SectionHeader>Signatures</SectionHeader>
              <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                <FieldRow label="Name of Reporter" value={inc.reporter_name} />
                <FieldRow label="Name of Supervisor" value={inc.supervisor_name} />
                <FieldRow label="Signature of Reporter" value={inc.reporter_signature} />
                <FieldRow label="Signature of Supervisor" value={inc.supervisor_signature} />
                <FieldRow
                  label="Date Signed by Reporter"
                  value={inc.date_signed_reporter ? format(new Date(inc.date_signed_reporter + "T00:00:00"), "d MMM yyyy") : null}
                />
                <FieldRow
                  label="Date Signed by Supervisor"
                  value={inc.date_signed_supervisor ? format(new Date(inc.date_signed_supervisor + "T00:00:00"), "d MMM yyyy") : null}
                />
              </div>
            </section>
          )}
        </div>
      </div>
    );
  }

  // ── New report form ─────────────────────────────────────────────────────────
  if (view === "new") {
    return (
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center justify-between">
          <button
            onClick={() => { setView("list"); reset(); }}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to reports
          </button>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-2 border-b border-border pb-4 mb-6">
            <AlertTriangle className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold text-foreground">Incident Report</h2>
            {restaurant && <span className="text-sm text-muted-foreground">— {restaurant.name}</span>}
          </div>

          <form onSubmit={handleSubmit((v) => saveIncident(v))} className="space-y-10">

            {/* ── Report Information ── */}
            <section className="space-y-4">
              <SectionHeader>Report Information</SectionHeader>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="report_date">Date of Report</Label>
                  <Input id="report_date" type="date" {...register("report_date")}
                    className={cn(errors.report_date && "border-destructive")} />
                  {errors.report_date && <p className="text-xs text-destructive">{errors.report_date.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="report_prepared_by">Report Prepared By</Label>
                  <Input id="report_prepared_by" placeholder="Full name"
                    {...register("report_prepared_by")}
                    className={cn(errors.report_prepared_by && "border-destructive")} />
                  {errors.report_prepared_by && <p className="text-xs text-destructive">{errors.report_prepared_by.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="incident_date">Date of Incident</Label>
                  <Input id="incident_date" type="date" {...register("incident_date")}
                    className={cn(errors.incident_date && "border-destructive")} />
                  {errors.incident_date && <p className="text-xs text-destructive">{errors.incident_date.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="location">Location of Incident</Label>
                  <Input id="location" placeholder="e.g. Kitchen, Front of house"
                    {...register("location")} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Type of Incident</Label>
                {errors.incident_type && <p className="text-xs text-destructive">{errors.incident_type.message}</p>}
                <div className="flex flex-wrap gap-3">
                  {INCIDENT_TYPES.map((type) => (
                    <label key={type.value} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        value={type.value}
                        checked={selectedType === type.value}
                        onChange={() => setValue("incident_type", type.value)}
                        className="accent-primary"
                      />
                      <span className="text-sm">{type.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="description">Incident Description</Label>
                <Textarea id="description" rows={3} placeholder="Brief description of the incident..."
                  {...register("description")} />
              </div>
            </section>

            {/* ── Parties Involved ── */}
            <section className="space-y-4">
              <SectionHeader>Parties Involved</SectionHeader>
              {[1, 2, 3].map((n) => (
                <div key={n} className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor={`party${n}_name`}>Party {n} Name</Label>
                    <Input id={`party${n}_name`} placeholder="Full name"
                      {...register(`party${n}_name` as keyof FormValues)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`party${n}_contact`}>Party {n} Contact</Label>
                    <Input id={`party${n}_contact`} placeholder="Phone or email"
                      {...register(`party${n}_contact` as keyof FormValues)} />
                  </div>
                </div>
              ))}
            </section>

            {/* ── Incident Details ── */}
            <section className="space-y-4">
              <SectionHeader>Incident Details</SectionHeader>
              <div className="space-y-1.5">
                <Label htmlFor="incident_detail">Describe the incident in detail</Label>
                <Textarea id="incident_detail" rows={5} placeholder="Provide a full account of what happened..."
                  {...register("incident_detail")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="immediate_actions">Summarize the immediate actions taken</Label>
                <Textarea id="immediate_actions" rows={4} placeholder="What was done immediately after the incident..."
                  {...register("immediate_actions")} />
              </div>
            </section>

            {/* ── Investigation and Findings ── */}
            <section className="space-y-4">
              <SectionHeader>Investigation and Findings</SectionHeader>
              <div className="space-y-1.5">
                <Label htmlFor="conclusions">Discuss any immediate conclusions drawn from the incident</Label>
                <Textarea id="conclusions" rows={4} placeholder="Initial conclusions..."
                  {...register("conclusions")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cause">Identify the cause of the incident</Label>
                <Textarea id="cause" rows={4} placeholder="Root cause analysis..."
                  {...register("cause")} />
              </div>
            </section>

            {/* ── Corrective Actions ── */}
            <section className="space-y-4">
              <SectionHeader>Corrective Actions</SectionHeader>
              <div className="space-y-1.5">
                <Label htmlFor="corrective_actions_detail">Describe the corrective actions taken</Label>
                <Textarea id="corrective_actions_detail" rows={4} placeholder="Actions already taken to address the incident..."
                  {...register("corrective_actions_detail")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prevention_steps">Outline steps for preventing a recurrence of the incident</Label>
                <Textarea id="prevention_steps" rows={4} placeholder="Prevention measures..."
                  {...register("prevention_steps")} />
              </div>
            </section>

            {/* ── Conclusion ── */}
            <section className="space-y-4">
              <SectionHeader>Conclusion</SectionHeader>
              <div className="space-y-1.5">
                <Label htmlFor="follow_up">Indicate whether there will be a follow-up action</Label>
                <Textarea id="follow_up" rows={3} placeholder="Follow-up plan..."
                  {...register("follow_up")} />
              </div>
            </section>

            {/* ── Signatures ── */}
            <section className="space-y-4">
              <SectionHeader>Signatures</SectionHeader>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="reporter_name">Name of Reporter</Label>
                  <Input id="reporter_name" placeholder="Full name" {...register("reporter_name")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="supervisor_name">Name of Supervisor</Label>
                  <Input id="supervisor_name" placeholder="Full name" {...register("supervisor_name")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reporter_signature">Signature of Reporter</Label>
                  <Input id="reporter_signature" placeholder="Type full name as signature"
                    {...register("reporter_signature")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="supervisor_signature">Signature of Supervisor</Label>
                  <Input id="supervisor_signature" placeholder="Type full name as signature"
                    {...register("supervisor_signature")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="date_signed_reporter">Date Signed by Reporter</Label>
                  <Input id="date_signed_reporter" type="date" {...register("date_signed_reporter")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="date_signed_supervisor">Date Signed by Supervisor</Label>
                  <Input id="date_signed_supervisor" type="date" {...register("date_signed_supervisor")} />
                </div>
              </div>
            </section>

            <div className="flex gap-3 pt-2 border-t border-border">
              <Button type="submit" disabled={isPending} className="flex-1">
                {isPending ? "Saving..." : "Save Incident Report"}
              </Button>
              <Button type="button" variant="outline" onClick={() => { setView("list"); reset(); }}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ── List view ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Incidents</h2>
          {restaurant && <span className="text-sm text-muted-foreground">— {restaurant.name}</span>}
        </div>
        <Button onClick={() => setView("new")} size="sm">
          <PlusCircle className="h-4 w-4 mr-1.5" />
          New Report
        </Button>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      ) : incidents.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No incident reports yet.</p>
          <button onClick={() => setView("new")} className="mt-3 text-sm text-primary hover:underline">
            Create the first report
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {incidents.map((inc) => (
            <div
              key={inc.id}
              className="rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-foreground truncate">{inc.title}</span>
                  <Badge className={cn("border text-xs capitalize shrink-0", STATUS_COLORS[inc.status])}>
                    {inc.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{format(new Date(inc.incident_date), "d MMM yyyy")}</span>
                  {inc.location && <><span>·</span><span>{inc.location}</span></>}
                  {inc.report_prepared_by && <><span>·</span><span>by {inc.report_prepared_by}</span></>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => { setSelectedIncident(inc); setView("detail"); }}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  title="View report"
                >
                  <Eye className="h-4 w-4" />
                </button>
                {isSuperadmin && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this incident report?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Permanently deletes the report for{" "}
                          <span className="font-medium text-foreground">{inc.title}</span>.
                          This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteIncident(inc.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
