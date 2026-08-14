import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { Badge, Sidebar, SidebarItem, SidebarSection } from "@stayw/ui";
import { Bell, Bot } from "lucide-react";
import Link from "next/link";

import { listPendingAiActions } from "@/domains/ai/services/ai.service";
import { safeList } from "@/domains/dashboard/services/dashboard.service";
import { listNotifications } from "@/domains/notifications/services/notifications.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";
import { NAV_SECTIONS } from "@/platform/layout/nav-config";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await getCurrentUser();

  // safeList() degrades to [] for roles without notifications:read/
  // ai_actions:read (cleaner, maintenance_tech, front_desk) instead of
  // throwing — this chrome renders on every route, so it must never crash
  // the layout for a role that simply can't see one of these lists.
  const [clerkUser, notifications, pendingActions] = await Promise.all([
    currentUser(),
    safeList(() => listNotifications(actor)),
    safeList(() => listPendingAiActions(actor)),
  ]);

  const unreadCount = notifications.filter((n) => !n.readAt).length;
  const pendingCount = pendingActions.length;

  const displayName = clerkUser
    ? [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      clerkUser.primaryEmailAddress?.emailAddress ||
      "Signed in"
    : "Signed in";

  return (
    <div className="min-h-screen bg-ivory lg:pl-64">
      <Sidebar
        brand={
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-forest-600 font-display text-sm font-semibold text-white">
              S
            </span>
            <span>
              <span className="block font-display text-[15px] font-semibold leading-tight text-ink">
                StayWhile
              </span>
              <span className="block text-[11px] tracking-wide text-ink-muted">
                OPERATIONS
              </span>
            </span>
          </Link>
        }
        footer={
          <div className="flex items-center gap-3 rounded-lg px-1.5 py-1.5">
            <UserButton appearance={{ elements: { avatarBox: "h-8 w-8" } }} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">
                {displayName}
              </p>
              {clerkUser?.primaryEmailAddress?.emailAddress && (
                <p className="truncate text-xs text-ink-muted">
                  {clerkUser.primaryEmailAddress.emailAddress}
                </p>
              )}
            </div>
          </div>
        }
      >
        {NAV_SECTIONS.map((section) => (
          <SidebarSection key={section.label} label={section.label}>
            {section.items.map((item) => (
              <SidebarItem
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                featured={item.featured}
                badge={
                  item.href === "/notifications" && unreadCount > 0 ? (
                    <Badge tone="error">{unreadCount}</Badge>
                  ) : item.href === "/ai" && pendingCount > 0 ? (
                    <Badge tone="gold">{pendingCount}</Badge>
                  ) : undefined
                }
              />
            ))}
          </SidebarSection>
        ))}
      </Sidebar>

      <div className="flex min-h-screen flex-col">
        <header className="flex h-16 shrink-0 items-center justify-end gap-2 border-b border-border px-6 lg:px-10">
          <Link
            href="/notifications"
            aria-label="Notifications"
            className="relative rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-error-500" />
            )}
          </Link>
          <Link
            href="/ai"
            aria-label="AI Assistant"
            className="relative rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <Bot className="h-5 w-5" />
            {pendingCount > 0 && (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-gold-500" />
            )}
          </Link>
        </header>
        <main className="flex-1 px-6 py-8 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
