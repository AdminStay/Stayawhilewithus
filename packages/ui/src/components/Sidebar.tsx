"use client";

import {
  Bell,
  Bot,
  Building2,
  CalendarRange,
  ListChecks,
  Menu,
  MessageSquare,
  Plug,
  Sparkles,
  ShieldCheck,
  UserCog,
  Users,
  Wrench,
  LayoutDashboard,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";

import { cx } from "../lib/cx";

/**
 * Icons are resolved from a string key rather than accepted as a component
 * reference prop. A Server Component (apps/website's dashboard layout)
 * instantiates SidebarItem, and this whole module is a Client Component
 * (needs usePathname()) — a raw component/function value can't cross that
 * Server → Client boundary as a prop (React can only serialize plain
 * data), even though the same icon rendered directly inside a non-client
 * component (StatCard, EmptyState) is fine. Keeping the lookup table here,
 * inside the client module, means the nav config on the server side only
 * ever needs to hand over a plain string.
 */
const NAV_ICONS = {
  dashboard: LayoutDashboard,
  building: Building2,
  calendar: CalendarRange,
  users: Users,
  checklist: ListChecks,
  sparkles: Sparkles,
  wrench: Wrench,
  bell: Bell,
  message: MessageSquare,
  bot: Bot,
  plug: Plug,
  shield: ShieldCheck,
  userCog: UserCog,
} as const;

export type NavIconKey = keyof typeof NAV_ICONS;

const SidebarMobileContext = createContext<{ close: () => void } | null>(null);

export interface SidebarProps {
  brand: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}

export function Sidebar({ brand, footer, children }: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const close = () => setMobileOpen(false);

  return (
    <SidebarMobileContext.Provider value={{ close }}>
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        className="fixed left-4 top-4 z-30 rounded-lg border border-border bg-surface p-2 shadow-card lg:hidden"
      >
        <Menu className="h-5 w-5 text-ink" />
      </button>

      {mobileOpen && (
        <div
          onClick={close}
          aria-hidden
          className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-surface-muted transition-transform duration-200 ease-out lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close menu"
          className="absolute right-4 top-5 rounded-lg p-1.5 text-ink-muted hover:bg-surface lg:hidden"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex h-16 shrink-0 items-center border-b border-border/70 px-5">
          {brand}
        </div>
        <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 py-5">
          {children}
        </nav>
        <div className="border-t border-border/70 px-3 py-3.5">{footer}</div>
      </aside>
    </SidebarMobileContext.Provider>
  );
}

export function SidebarSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-6 last:mb-0">
      <p className="mb-1 px-2.5 text-[10.5px] font-semibold uppercase tracking-widest text-ink-faint">
        {label}
      </p>
      <div className="space-y-px">{children}</div>
    </div>
  );
}

export interface SidebarItemProps {
  href: string;
  label: string;
  icon: NavIconKey;
  badge?: ReactNode;
  /** Marks a flagship entry (e.g. AI Assistant) with a distinct at-rest treatment, not just an active-state highlight. */
  featured?: boolean;
}

export function SidebarItem({
  href,
  label,
  icon,
  badge,
  featured,
}: SidebarItemProps) {
  const Icon = NAV_ICONS[icon];
  const pathname = usePathname();
  const mobile = useContext(SidebarMobileContext);
  const active =
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname?.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      onClick={mobile?.close}
      className={cx(
        "relative flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors",
        active
          ? "bg-forest-50 font-semibold text-forest-800"
          : featured
            ? "font-medium text-ink hover:bg-surface"
            : "font-medium text-ink-muted hover:bg-surface hover:text-ink",
      )}
    >
      {active && (
        <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-forest-600" />
      )}
      <Icon
        className={cx(
          "h-[17px] w-[17px] shrink-0",
          active
            ? "text-forest-600"
            : featured
              ? "text-gold-600"
              : "text-ink-faint",
        )}
      />
      <span className="flex-1 truncate">{label}</span>
      {badge}
    </Link>
  );
}
