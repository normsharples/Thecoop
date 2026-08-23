import { useState } from "react";
import { Users, DollarSign, GraduationCap, FileSignature } from "lucide-react";
import TeamSettings from "@/components/settings/TeamSettings";
import PayrollSettings from "@/components/settings/PayrollSettings";
import TrainingSettings from "@/components/settings/TrainingSettings";
import ContractTemplates from "@/components/onboarding/ContractTemplates";
import { cn } from "@/lib/utils";

export default function TeamPage() {
  const [tab, setTab] = useState<"members" | "contracts" | "training" | "payroll">("members");
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Users className="h-7 w-7 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Team</h1>
      </div>

      <div className="inline-flex rounded-lg border border-border p-0.5">
        <TabBtn active={tab === "members"} onClick={() => setTab("members")} icon={Users}>
          Team
        </TabBtn>
        <TabBtn active={tab === "contracts"} onClick={() => setTab("contracts")} icon={FileSignature}>
          Contracts
        </TabBtn>
        <TabBtn active={tab === "training"} onClick={() => setTab("training")} icon={GraduationCap}>
          Training
        </TabBtn>
        <TabBtn active={tab === "payroll"} onClick={() => setTab("payroll")} icon={DollarSign}>
          Payroll
        </TabBtn>
      </div>

      {tab === "members" ? (
        <TeamSettings />
      ) : tab === "contracts" ? (
        <ContractTemplates />
      ) : tab === "training" ? (
        <TrainingSettings />
      ) : (
        <PayrollSettings />
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Users;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}
