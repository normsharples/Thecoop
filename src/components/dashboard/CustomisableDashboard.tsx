import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Loader2, Plus, RotateCcw, Settings2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { WidgetScope } from "@/contexts/WidgetScope";
import { useRestaurants } from "@/hooks/useRestaurants";
import { useDashboardLayout, type LayoutTarget } from "@/hooks/useDashboardLayout";
import {
  CHANNEL_OPTIONS, SIZE_CLASS, SIZE_LABEL, WIDGETS, createWidget, instanceLabel, widgetDef,
  type DashboardLayout, type DashboardPeriod, type WidgetInstance, type WidgetSettings,
  type WidgetSize, type WidgetType,
} from "@/lib/dashboardWidgets";

// ============================================================================
// CUSTOMISABLE DASHBOARD
// ----------------------------------------------------------------------------
// View mode renders the resolved layout. Edit mode works on a local draft —
// drag to reorder, resize, configure, add/remove — and only touches the
// database on Save.
// ============================================================================

interface Props {
  period: DashboardPeriod;
  editing: boolean;
  onDoneEditing: () => void;
}

export function CustomisableDashboard({ period, editing, onDoneEditing }: Props) {
  const dash = useDashboardLayout();
  const { data: restaurants = [] } = useRestaurants();
  const accessibleIds = useMemo(() => new Set(restaurants.map((r) => r.id)), [restaurants]);

  const [target, setTarget] = useState<LayoutTarget>("personal");
  const [draft, setDraft] = useState<DashboardLayout | null>(null);
  const [adding, setAdding] = useState(false);
  const [configuring, setConfiguring] = useState<WidgetInstance | null>(null);

  // Start (or restart) the draft whenever edit mode opens or the target flips.
  useEffect(() => {
    if (editing) setDraft(structuredClone(dash.layoutFor(target)));
    else setDraft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, target, dash.brandId, dash.isLoading]);

  const layout = editing && draft ? draft : dash.layout;

  // A widget pinned to venues this person can't see (e.g. a brand default set
  // by a superadmin) quietly falls back to the page selection.
  const scopeFor = (w: WidgetInstance) => {
    const ids = (w.settings.restaurantIds ?? []).filter((id) => accessibleIds.has(id));
    return ids.length ? ids : null;
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function update(fn: (widgets: WidgetInstance[]) => WidgetInstance[]) {
    setDraft((d) => (d ? { ...d, widgets: fn(d.widgets) } : d));
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    update((ws) => {
      const from = ws.findIndex((w) => w.id === active.id);
      const to = ws.findIndex((w) => w.id === over.id);
      return from < 0 || to < 0 ? ws : arrayMove(ws, from, to);
    });
  }

  async function handleSave() {
    if (!draft) return;
    try {
      await dash.save.mutateAsync({ target, layout: draft });
      toast.success(target === "personal" ? "Dashboard saved" : `${defaultName} saved`);
      onDoneEditing();
    } catch (err) {
      toast.error(`Couldn't save: ${(err as Error).message}`);
    }
  }

  async function handleReset() {
    try {
      if (target === "personal") {
        await dash.resetPersonal.mutateAsync();
        toast.success("Back to the default dashboard");
      } else {
        await dash.resetDefault.mutateAsync();
        toast.success(`${defaultName} cleared`);
      }
      onDoneEditing();
    } catch (err) {
      toast.error(`Couldn't reset: ${(err as Error).message}`);
    }
  }

  const defaultName = dash.brand ? `${dash.brand.name} default` : "Default dashboard";
  const canReset = target === "personal" ? dash.hasPersonal : dash.hasDefault;
  const saving = dash.save.isPending || dash.resetPersonal.isPending || dash.resetDefault.isPending;

  if (dash.isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-40 animate-pulse rounded-xl border border-border bg-card" />
        <div className="h-28 animate-pulse rounded-xl border border-border bg-card" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {editing && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-popover">
          {dash.canEditDefault ? (
            <div className="flex overflow-hidden rounded-lg border border-input text-xs font-medium">
              {(["personal", "default"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTarget(t)}
                  className={cn(
                    "px-3 py-1.5 transition-colors",
                    target === t
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  {t === "personal" ? "My dashboard" : defaultName}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-xs font-medium text-foreground">Editing my dashboard</span>
          )}
          <span className="hidden text-xs text-muted-foreground md:inline">
            {target === "personal"
              ? "Only you see this layout."
              : dash.brand
                ? `Everyone viewing ${dash.brand.name} sees this unless they've customised their own.`
                : "Shown when no brand is selected, and for brands without their own default."}
          </span>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setAdding(true)} disabled={saving}>
              <Plus className="h-3.5 w-3.5" /> Add widget
            </Button>
            {canReset && (
              <Button size="sm" variant="ghost" onClick={handleReset} disabled={saving}>
                <RotateCcw className="h-3.5 w-3.5" />
                {target === "personal" ? "Reset to default" : "Clear default"}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onDoneEditing} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !draft}>
              {dash.save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      )}

      {layout.widgets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {editing ? "No widgets yet." : "This dashboard is empty."}
          </p>
          {editing && (
            <Button size="sm" className="mt-3" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" /> Add widget
            </Button>
          )}
        </div>
      ) : editing ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={layout.widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {layout.widgets.map((w) => (
                <SortableWidget
                  key={w.id}
                  widget={w}
                  onResize={(size) =>
                    update((ws) => ws.map((x) => (x.id === w.id ? { ...x, size } : x)))
                  }
                  onRemove={() => update((ws) => ws.filter((x) => x.id !== w.id))}
                  onConfigure={() => setConfiguring(w)}
                >
                  <WidgetScope restaurantIds={scopeFor(w)}>
                    {widgetDef(w.type).render(period, w.settings)}
                  </WidgetScope>
                </SortableWidget>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {layout.widgets.map((w) => (
            // empty:hidden — widgets like Alerts render nothing when there's
            // nothing to say; don't leave a gap behind.
            <div key={w.id} className={cn(SIZE_CLASS[w.size], "min-w-0 empty:hidden")}>
              <WidgetScope restaurantIds={scopeFor(w)}>
                {widgetDef(w.type).render(period, w.settings)}
              </WidgetScope>
            </div>
          ))}
        </div>
      )}

      <AddWidgetSheet
        open={adding}
        onOpenChange={setAdding}
        onAdd={(type) => {
          update((ws) => [...ws, createWidget(type)]);
          setAdding(false);
        }}
      />

      <WidgetSettingsDialog
        key={configuring?.id ?? "none"}
        widget={configuring}
        onClose={() => setConfiguring(null)}
        onSave={(settings) => {
          if (!configuring) return;
          update((ws) => ws.map((x) => (x.id === configuring.id ? { ...x, settings } : x)));
          setConfiguring(null);
        }}
      />
    </div>
  );
}

// ── Edit-mode tile ──────────────────────────────────────────────────────────

function SortableWidget({
  widget, onResize, onRemove, onConfigure, children,
}: {
  widget: WidgetInstance;
  onResize: (size: WidgetSize) => void;
  onRemove: () => void;
  onConfigure: () => void;
  children: ReactNode;
}) {
  const def = widgetDef(widget.type);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: widget.id });

  const venueCount = widget.settings.restaurantIds?.length ?? 0;
  const hasSettings = def.venueScoped || widget.type === "channel_sales";

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        SIZE_CLASS[widget.size],
        "min-w-0 rounded-xl border border-dashed border-border-strong bg-surface-subtle p-2",
        isDragging && "z-30 opacity-80 shadow-popover"
      )}
    >
      <div className="mb-2 flex items-center gap-1.5">
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
          aria-label={`Drag ${instanceLabel(widget)}`}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {instanceLabel(widget)}
          {venueCount > 0 && (
            <span className="ml-1.5 text-muted-foreground">
              · {venueCount} venue{venueCount === 1 ? "" : "s"}
            </span>
          )}
        </span>
        {def.sizes.length > 1 && (
          <Select value={widget.size} onValueChange={(v) => onResize(v as WidgetSize)}>
            <SelectTrigger className="h-7 w-auto gap-1 px-2 text-xs" aria-label="Widget size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {def.sizes.map((s) => (
                <SelectItem key={s} value={s} className="text-xs">
                  {SIZE_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {hasSettings && (
          <button
            onClick={onConfigure}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Widget settings"
          >
            <Settings2 className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={onRemove}
          className="rounded-md p-1 text-muted-foreground hover:bg-destructive-soft hover:text-destructive"
          aria-label="Remove widget"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {/* Live preview, but inert so links and buttons don't fire mid-edit. */}
      <div className="pointer-events-none select-none" aria-hidden>
        {children}
      </div>
    </div>
  );
}

// ── Add widget ──────────────────────────────────────────────────────────────

function AddWidgetSheet({
  open, onOpenChange, onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (type: WidgetType) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Add a widget</SheetTitle>
          <SheetDescription>
            Widgets can be added more than once — e.g. one channel card per channel,
            or the same card pinned to different venues.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-2">
          {(Object.keys(WIDGETS) as WidgetType[]).map((type) => {
            const def = widgetDef(type);
            const Icon = def.icon;
            return (
              <button
                key={type}
                onClick={() => onAdd(type)}
                className="flex w-full items-start gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent"
              >
                <div className="rounded-md bg-muted p-2 text-muted-foreground">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{def.label}</p>
                  <p className="text-xs text-muted-foreground">{def.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Widget settings ─────────────────────────────────────────────────────────

function WidgetSettingsDialog({
  widget, onClose, onSave,
}: {
  widget: WidgetInstance | null;
  onClose: () => void;
  onSave: (settings: WidgetSettings) => void;
}) {
  const { data: restaurants = [] } = useRestaurants();
  // Keyed on the widget id by the parent, so this seeds fresh per widget.
  const [settings, setSettings] = useState<WidgetSettings>(() =>
    widget ? structuredClone(widget.settings) : {}
  );

  if (!widget) return null;
  const def = widgetDef(widget.type);
  const picked = settings.restaurantIds ?? [];
  const followPage = picked.length === 0;

  function toggleVenue(id: string, on: boolean) {
    setSettings((s) => {
      const cur = s.restaurantIds ?? [];
      const next = on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id);
      return { ...s, restaurantIds: next };
    });
  }

  return (
    <Dialog open={!!widget} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{def.label} settings</DialogTitle>
          <DialogDescription>{def.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {widget.type === "channel_sales" && (
            <div className="space-y-1.5">
              <p className="eyebrow">Channel</p>
              <Select
                value={settings.channel ?? "delivery_sales"}
                onValueChange={(v) => setSettings((s) => ({ ...s, channel: v as WidgetSettings["channel"] }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CHANNEL_OPTIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {def.venueScoped && (
            <div className="space-y-2">
              <p className="eyebrow">Venues</p>
              <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                <Checkbox
                  checked={followPage}
                  onCheckedChange={(c) => c && setSettings((s) => ({ ...s, restaurantIds: [] }))}
                />
                Follow the venue picker at the top of the page
              </label>
              <div className="space-y-1.5 rounded-lg border border-border p-3">
                {restaurants.length === 0 && (
                  <p className="text-xs text-muted-foreground">No venues in this brand.</p>
                )}
                {restaurants.map((r) => (
                  <label key={r.id} className="flex cursor-pointer items-center gap-2.5 text-sm">
                    <Checkbox
                      checked={picked.includes(r.id)}
                      onCheckedChange={(c) => toggleVenue(r.id, !!c)}
                    />
                    {r.name}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Pinning venues locks this widget to them, whatever is picked at the top.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(settings)}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
