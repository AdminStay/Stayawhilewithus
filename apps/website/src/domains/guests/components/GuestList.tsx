import { Button, Card, ConfirmButton, EmptyState, Input } from "@stayw/ui";
import { Users } from "lucide-react";

import { deleteGuestAction, updateGuestAction } from "../actions";

import type { Guest } from "../services/guests.service";

export function GuestList({ guests }: { guests: Guest[] }) {
  if (guests.length === 0) {
    return (
      <Card noPadding>
        <EmptyState
          icon={Users}
          title="No guests yet"
          description="Add your first guest to get started."
        />
      </Card>
    );
  }

  return (
    <div className="divide-y divide-border rounded-card border border-border bg-surface shadow-card">
      {guests.map((g) => (
        <div key={g.id} className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="font-medium text-ink">
                {g.firstName} {g.lastName}
              </span>
              {g.email && (
                <span className="ml-2 text-sm text-ink-muted">{g.email}</span>
              )}
              {g.phone && (
                <span className="ml-2 text-sm text-ink-muted">{g.phone}</span>
              )}
            </div>
            <form action={deleteGuestAction}>
              <input type="hidden" name="guestId" value={g.id} />
              <ConfirmButton
                variant="danger"
                size="sm"
                confirmMessage={`Remove ${g.firstName} ${g.lastName}? They will disappear from every list until restored.`}
              >
                Remove
              </ConfirmButton>
            </form>
          </div>
          <form
            action={updateGuestAction}
            className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 sm:grid-cols-5"
          >
            <input type="hidden" name="guestId" value={g.id} />
            <Input name="firstName" defaultValue={g.firstName} required />
            <Input name="lastName" defaultValue={g.lastName} required />
            <Input
              name="email"
              type="email"
              defaultValue={g.email ?? ""}
              placeholder="Email"
            />
            <Input
              name="phone"
              defaultValue={g.phone ?? ""}
              placeholder="Phone"
            />
            <Button type="submit" variant="secondary">
              Save
            </Button>
            <Input
              name="notes"
              defaultValue={g.notes ?? ""}
              placeholder="Notes"
              className="col-span-full"
            />
          </form>
        </div>
      ))}
    </div>
  );
}
