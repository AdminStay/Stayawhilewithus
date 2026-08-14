import { DialogTrigger, PageHeader } from "@stayw/ui";

import { CreateGuestForm } from "@/domains/guests/components/CreateGuestForm";
import { GuestList } from "@/domains/guests/components/GuestList";
import { listGuests } from "@/domains/guests/services/guests.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function GuestsPage() {
  const actor = await getCurrentUser();
  const guests = await listGuests(actor);

  return (
    <div>
      <PageHeader
        title="Guests"
        subtitle={`${guests.length} ${guests.length === 1 ? "guest" : "guests"} on file`}
        actions={
          <DialogTrigger label="Add guest" title="Add guest">
            <CreateGuestForm />
          </DialogTrigger>
        }
      />
      <GuestList guests={guests} />
    </div>
  );
}
