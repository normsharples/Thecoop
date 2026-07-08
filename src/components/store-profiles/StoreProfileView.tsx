import { useState } from "react";
import {
  ArrowLeft,
  Phone,
  Clock,
  Wifi,
  Building2,
  Shield,
  Truck,
  FileText,
  Pencil,
  Eye,
  EyeOff,
} from "lucide-react";
import type { StoreProfile, Restaurant } from "@/types";
import { usePermissions } from "@/hooks/usePermissions";

interface StoreProfileViewProps {
  profile: StoreProfile;
  restaurant: Restaurant;
  onBack: () => void;
  onEdit: () => void;
}

export function StoreProfileView({
  profile,
  restaurant,
  onBack,
  onEdit,
}: StoreProfileViewProps) {
  const [showAlarmCode, setShowAlarmCode] = useState(false);
  const [showWifiPassword, setShowWifiPassword] = useState(false);
  const { isSuperadmin, canAccessRestaurant } = usePermissions();
  const canEdit = isSuperadmin || canAccessRestaurant(restaurant.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="rounded-lg p-2 hover:bg-accent transition-colors"
          >
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
          </button>
          <div>
            <h2 className="text-xl font-semibold text-foreground">{restaurant.name}</h2>
            <p className="text-sm text-muted-foreground">{restaurant.address}</p>
          </div>
        </div>
        {canEdit && (
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Contact */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Phone className="h-4 w-4 text-primary" />
            Contact Details
          </h3>
          <div className="space-y-3">
            <InfoRow label="Phone" value={profile.phone} />
            <InfoRow label="Email" value={profile.email} />
          </div>
        </div>

        {/* Trading Hours */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            Trading Hours
          </h3>
          <div className="space-y-2">
            {profile.trading_hours ? (
              Object.entries(profile.trading_hours).map(([day, hours]) => (
                <div key={day} className="flex justify-between text-sm">
                  <span className="text-muted-foreground capitalize">{day}</span>
                  <span className="text-foreground">{hours}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Not set</p>
            )}
          </div>
        </div>

        {/* IT / Security */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Wifi className="h-4 w-4 text-primary" />
            IT & Security
          </h3>
          <div className="space-y-3">
            <InfoRow label="WiFi Network" value={profile.wifi_network} />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">WiFi Password</p>
                <p className="text-sm text-foreground">
                  {showWifiPassword
                    ? profile.wifi_password ?? "Not set"
                    : profile.wifi_password
                    ? "••••••••"
                    : "Not set"}
                </p>
              </div>
              {profile.wifi_password && (
                <button
                  onClick={() => setShowWifiPassword(!showWifiPassword)}
                  className="rounded-md p-1 text-muted-foreground hover:text-foreground"
                >
                  {showWifiPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Alarm Code</p>
                <p className="text-sm text-foreground">
                  {showAlarmCode
                    ? profile.alarm_code ?? "Not set"
                    : profile.alarm_code
                    ? "••••••••"
                    : "Not set"}
                </p>
              </div>
              {profile.alarm_code && (
                <button
                  onClick={() => setShowAlarmCode(!showAlarmCode)}
                  className="rounded-md p-1 text-muted-foreground hover:text-foreground"
                >
                  {showAlarmCode ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Key Contacts */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            Key Contacts
          </h3>
          {profile.key_contacts && profile.key_contacts.length > 0 ? (
            <div className="space-y-3">
              {profile.key_contacts.map((contact, i) => (
                <div key={i} className="border-b border-border pb-2 last:border-0 last:pb-0">
                  <p className="text-sm font-medium text-foreground">{contact.name}</p>
                  <p className="text-xs text-muted-foreground">{contact.role}</p>
                  <p className="text-xs text-muted-foreground">{contact.phone}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No contacts added</p>
          )}
        </div>

        {/* Council & Insurance */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Council & Insurance
          </h3>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground">Council Details</p>
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {profile.council_details ?? "Not set"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Insurance Details</p>
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {profile.insurance_details ?? "Not set"}
              </p>
            </div>
          </div>
        </div>

        {/* Suppliers */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Truck className="h-4 w-4 text-primary" />
            Suppliers
          </h3>
          {profile.suppliers && profile.suppliers.length > 0 ? (
            <div className="space-y-3">
              {profile.suppliers.map((supplier, i) => (
                <div key={i} className="border-b border-border pb-2 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground">{supplier.name}</p>
                    <span className="text-xs text-muted-foreground">{supplier.category}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{supplier.phone}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No suppliers added</p>
          )}
        </div>
      </div>

      {/* Notes */}
      {profile.notes && (
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Notes
          </h3>
          <p className="text-sm text-foreground whitespace-pre-wrap">{profile.notes}</p>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">{value ?? "Not set"}</p>
    </div>
  );
}
