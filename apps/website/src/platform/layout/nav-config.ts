import type { NavIconKey } from "@stayw/ui";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconKey;
  featured?: boolean;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Operations",
    items: [
      { href: "/", label: "Dashboard", icon: "dashboard" },
      { href: "/properties", label: "Properties", icon: "building" },
      { href: "/locks", label: "Locks", icon: "lock" },
      { href: "/thermostats", label: "Thermostats", icon: "thermometer" },
      { href: "/reservations", label: "Reservations", icon: "calendar" },
      { href: "/ownerrez", label: "OwnerRez", icon: "calendar" },
      { href: "/notion", label: "Notion", icon: "plug" },
      { href: "/guests", label: "Guests", icon: "users" },
    ],
  },
  {
    label: "Management",
    items: [
      { href: "/tasks", label: "Tasks", icon: "checklist" },
      { href: "/cleaning", label: "Cleaning", icon: "sparkles" },
      { href: "/maintenance", label: "Maintenance", icon: "wrench" },
    ],
  },
  {
    label: "Communication",
    items: [
      { href: "/notifications", label: "Notifications", icon: "bell" },
      { href: "/communications", label: "Communications", icon: "message" },
      { href: "/ai", label: "AI Assistant", icon: "bot", featured: true },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/integrations", label: "Integrations", icon: "plug" },
      {
        href: "/integrations/devices",
        label: "Discovered Devices",
        icon: "plug",
      },
      { href: "/audit", label: "Audit", icon: "shield" },
      { href: "/users", label: "Users", icon: "userCog" },
    ],
  },
];
