import { PageHeader } from "@stayw/ui";

import { NotificationList } from "@/domains/notifications/components/NotificationList";
import { listNotifications } from "@/domains/notifications/services/notifications.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function NotificationsPage() {
  const actor = await getCurrentUser();
  const notifications = await listNotifications(actor);
  const unreadCount = notifications.filter((n) => !n.readAt).length;

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle={
          unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"
        }
      />
      <NotificationList notifications={notifications} />
    </div>
  );
}
