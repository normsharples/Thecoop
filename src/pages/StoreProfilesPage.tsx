import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Store, MapPin, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useRestaurants } from "@/hooks/useRestaurants";
import { StoreProfileView } from "@/components/store-profiles/StoreProfileView";
import { StoreProfileForm } from "@/components/store-profiles/StoreProfileForm";
import { toast } from "sonner";
import type { Restaurant, StoreProfile } from "@/types";

type View = "list" | "detail" | "edit";

export default function StoreProfilesPage() {
  const [view, setView] = useState<View>("list");
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const queryClient = useQueryClient();
  const { data: restaurants, isLoading: restaurantsLoading } = useRestaurants();

  const { data: storeProfiles, isLoading: profilesLoading } = useQuery({
    queryKey: ["store-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("store_profiles").select("*");
      if (error) throw error;
      return data as StoreProfile[];
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      restaurantId,
      data,
    }: {
      restaurantId: string;
      data: Partial<StoreProfile>;
    }) => {
      const existing = storeProfiles?.find((p) => p.restaurant_id === restaurantId);
      if (existing) {
        const { error } = await supabase
          .from("store_profiles")
          .update({ ...data, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("store_profiles").insert({
          restaurant_id: restaurantId,
          ...data,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Store profile updated");
      queryClient.invalidateQueries({ queryKey: ["store-profiles"] });
      setView("detail");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const isLoading = restaurantsLoading || profilesLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (view === "detail" && selectedRestaurant) {
    const profile = storeProfiles?.find(
      (p) => p.restaurant_id === selectedRestaurant.id
    );
    const defaultProfile: StoreProfile = {
      id: "",
      restaurant_id: selectedRestaurant.id,
      phone: null,
      email: null,
      trading_hours: null,
      key_contacts: null,
      wifi_network: null,
      wifi_password: null,
      alarm_code: null,
      council_details: null,
      insurance_details: null,
      suppliers: null,
      notes: null,
      created_at: "",
      updated_at: "",
    };

    return (
      <StoreProfileView
        profile={profile ?? defaultProfile}
        restaurant={selectedRestaurant}
        onBack={() => {
          setView("list");
          setSelectedRestaurant(null);
        }}
        onEdit={() => setView("edit")}
      />
    );
  }

  if (view === "edit" && selectedRestaurant) {
    const profile = storeProfiles?.find(
      (p) => p.restaurant_id === selectedRestaurant.id
    ) ?? null;

    return (
      <StoreProfileForm
        profile={profile}
        restaurant={selectedRestaurant}
        onBack={() => setView("detail")}
        onSubmit={(data) =>
          updateMutation.mutate({ restaurantId: selectedRestaurant.id, data })
        }
        isSubmitting={updateMutation.isPending}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Store Profiles</h2>
        <p className="text-sm text-muted-foreground">
          View and manage details for each restaurant location
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {restaurants?.map((restaurant) => {
          const profile = storeProfiles?.find(
            (p) => p.restaurant_id === restaurant.id
          );
          return (
            <button
              key={restaurant.id}
              onClick={() => {
                setSelectedRestaurant(restaurant);
                setView("detail");
              }}
              className="rounded-xl border border-border bg-card p-6 text-left hover:border-primary/50 transition-all group"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 group-hover:bg-primary/20 transition-colors">
                  <Store className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors">
                    {restaurant.name}
                  </h3>
                  {restaurant.address && (
                    <p className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{restaurant.address}</span>
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    <span
                      className={`inline-flex h-2 w-2 rounded-full ${
                        restaurant.status === "active"
                          ? "bg-success"
                          : restaurant.status === "grace_period"
                          ? "bg-warning"
                          : "bg-muted-foreground"
                      }`}
                    />
                    <span className="text-xs text-muted-foreground capitalize">
                      {restaurant.status.replace("_", " ")}
                    </span>
                  </div>
                  {profile?.phone && (
                    <p className="text-xs text-muted-foreground mt-2">
                      {profile.phone}
                    </p>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
