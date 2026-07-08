import {
  ExternalLink,
  Clock,
  BarChart3,
  Receipt,
  Truck,
  ShoppingBag,
} from "lucide-react";

interface QuickLink {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const links: QuickLink[] = [
  {
    label: "Deputy",
    href: "https://www.deputy.com",
    icon: <Clock className="h-5 w-5" />,
  },
  {
    label: "Lightspeed",
    href: "https://www.lightspeedhq.com",
    icon: <BarChart3 className="h-5 w-5" />,
  },
  {
    label: "Google Business",
    href: "https://business.google.com",
    icon: <ExternalLink className="h-5 w-5" />,
  },
  {
    label: "Xero",
    href: "https://www.xero.com",
    icon: <Receipt className="h-5 w-5" />,
  },
  {
    label: "Uber Eats",
    href: "https://merchants.ubereats.com",
    icon: <Truck className="h-5 w-5" />,
  },
  {
    label: "DoorDash",
    href: "https://merchant.doordash.com",
    icon: <ShoppingBag className="h-5 w-5" />,
  },
];

export function QuickLinks() {
  return (
    <div className="grid grid-cols-3 gap-3 lg:grid-cols-6">
      {links.map((link) => (
        <a
          key={link.label}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          {link.icon}
          <span className="text-xs font-medium">{link.label}</span>
        </a>
      ))}
    </div>
  );
}
