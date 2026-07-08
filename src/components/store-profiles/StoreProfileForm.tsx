import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Loader2 } from "lucide-react";
import type { StoreProfile, Restaurant } from "@/types";

const storeProfileSchema = z.object({
  phone: z.string().optional(),
  email: z.email().optional().or(z.literal("")),
  wifi_network: z.string().optional(),
  wifi_password: z.string().optional(),
  alarm_code: z.string().optional(),
  council_details: z.string().optional(),
  insurance_details: z.string().optional(),
  notes: z.string().optional(),
  trading_hours_mon: z.string().optional(),
  trading_hours_tue: z.string().optional(),
  trading_hours_wed: z.string().optional(),
  trading_hours_thu: z.string().optional(),
  trading_hours_fri: z.string().optional(),
  trading_hours_sat: z.string().optional(),
  trading_hours_sun: z.string().optional(),
});

type StoreProfileFormData = z.infer<typeof storeProfileSchema>;

interface StoreProfileFormProps {
  profile: StoreProfile | null;
  restaurant: Restaurant;
  onBack: () => void;
  onSubmit: (data: Partial<StoreProfile>) => void;
  isSubmitting: boolean;
}

export function StoreProfileForm({
  profile,
  restaurant,
  onBack,
  onSubmit,
  isSubmitting,
}: StoreProfileFormProps) {
  const tradingHours = profile?.trading_hours as Record<string, string> | null;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<StoreProfileFormData>({
    resolver: zodResolver(storeProfileSchema),
    defaultValues: {
      phone: profile?.phone ?? "",
      email: profile?.email ?? "",
      wifi_network: profile?.wifi_network ?? "",
      wifi_password: profile?.wifi_password ?? "",
      alarm_code: profile?.alarm_code ?? "",
      council_details: profile?.council_details ?? "",
      insurance_details: profile?.insurance_details ?? "",
      notes: profile?.notes ?? "",
      trading_hours_mon: tradingHours?.monday ?? "",
      trading_hours_tue: tradingHours?.tuesday ?? "",
      trading_hours_wed: tradingHours?.wednesday ?? "",
      trading_hours_thu: tradingHours?.thursday ?? "",
      trading_hours_fri: tradingHours?.friday ?? "",
      trading_hours_sat: tradingHours?.saturday ?? "",
      trading_hours_sun: tradingHours?.sunday ?? "",
    },
  });

  const onFormSubmit = (data: StoreProfileFormData) => {
    const tradingHoursObj: Record<string, string> = {};
    if (data.trading_hours_mon) tradingHoursObj.monday = data.trading_hours_mon;
    if (data.trading_hours_tue) tradingHoursObj.tuesday = data.trading_hours_tue;
    if (data.trading_hours_wed) tradingHoursObj.wednesday = data.trading_hours_wed;
    if (data.trading_hours_thu) tradingHoursObj.thursday = data.trading_hours_thu;
    if (data.trading_hours_fri) tradingHoursObj.friday = data.trading_hours_fri;
    if (data.trading_hours_sat) tradingHoursObj.saturday = data.trading_hours_sat;
    if (data.trading_hours_sun) tradingHoursObj.sunday = data.trading_hours_sun;

    onSubmit({
      phone: data.phone || null,
      email: data.email || null,
      wifi_network: data.wifi_network || null,
      wifi_password: data.wifi_password || null,
      alarm_code: data.alarm_code || null,
      council_details: data.council_details || null,
      insurance_details: data.insurance_details || null,
      notes: data.notes || null,
      trading_hours: Object.keys(tradingHoursObj).length > 0 ? tradingHoursObj : null,
    });
  };

  const inputClass =
    "flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";
  const textareaClass =
    "flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-[80px]";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-lg p-2 hover:bg-accent transition-colors"
        >
          <ArrowLeft className="h-4 w-4 text-muted-foreground" />
        </button>
        <div>
          <h2 className="text-xl font-semibold text-foreground">
            Edit {restaurant.name}
          </h2>
          <p className="text-sm text-muted-foreground">Update store profile details</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-6">
        {/* Contact */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Contact Details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Phone</label>
              <input className={inputClass} placeholder="03 9123 4567" {...register("phone")} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Email</label>
              <input className={inputClass} placeholder="cbd@pollorotisserie.com.au" {...register("email")} />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>
          </div>
        </div>

        {/* Trading Hours */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Trading Hours</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              ["Monday", "trading_hours_mon"],
              ["Tuesday", "trading_hours_tue"],
              ["Wednesday", "trading_hours_wed"],
              ["Thursday", "trading_hours_thu"],
              ["Friday", "trading_hours_fri"],
              ["Saturday", "trading_hours_sat"],
              ["Sunday", "trading_hours_sun"],
            ].map(([day, field]) => (
              <div key={field} className="space-y-1">
                <label className="text-xs text-muted-foreground">{day}</label>
                <input
                  className={inputClass}
                  placeholder="11:00 AM – 9:00 PM"
                  {...register(field as keyof StoreProfileFormData)}
                />
              </div>
            ))}
          </div>
        </div>

        {/* IT & Security */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">IT & Security</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">WiFi Network</label>
              <input className={inputClass} placeholder="Pollo-Staff" {...register("wifi_network")} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">WiFi Password</label>
              <input className={inputClass} placeholder="••••••••" {...register("wifi_password")} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Alarm Code</label>
              <input className={inputClass} placeholder="••••" {...register("alarm_code")} />
            </div>
          </div>
        </div>

        {/* Council & Insurance */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Council & Insurance</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Council Details</label>
              <textarea className={textareaClass} {...register("council_details")} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Insurance Details</label>
              <textarea className={textareaClass} {...register("insurance_details")} />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Notes</h3>
          <textarea
            className={textareaClass}
            placeholder="Any additional notes about this store..."
            {...register("notes")}
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Changes
          </button>
        </div>
      </form>
    </div>
  );
}
