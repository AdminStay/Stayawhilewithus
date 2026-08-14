import { Badge, Button, Card, EmptyState } from "@stayw/ui";
import { Bell } from "lucide-react";

import { markNotificationReadAction } from "../actions";

import type { Notification } from "../services/notifications.service";

function formatDate(date: Date): string {
  return new Date(date).toLocaleString();
}

export function NotificationList({
  notifications,
}: {
  notifications: Notification[];
}) {
  if (notifications.length === 0) {
    return (
      <Card noPadding>
        <EmptyState icon={Bell} title="No notifications yet" />
      </Card>
    );
  }

  return (
    <Card noPadding>
      <ul className="divide-y divide-border">
        {notifications.map((n) => (
          <li
            key={n.id}
            className="flex items-center justify-between gap-4 px-5 py-4"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink">{n.title}</span>
                {!n.readAt && <Badge tone="gold">New</Badge>}
              </div>
              <p className="mt-0.5 text-sm text-ink-muted">{n.body}</p>
              <p className="mt-1 text-xs text-ink-faint">
                {formatDate(n.createdAt)}
              </p>
            </div>
            {!n.readAt && (
              <form action={markNotificationReadAction}>
                <input type="hidden" name="notificationId" value={n.id} />
                <Button type="submit" variant="secondary" size="sm">
                  Mark read
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
