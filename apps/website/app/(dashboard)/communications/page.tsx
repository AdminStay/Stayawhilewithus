import { DialogTrigger, PageHeader } from "@stayw/ui";

import { CreateMessageThreadForm } from "@/domains/communications/components/CreateMessageThreadForm";
import { MessageThreadList } from "@/domains/communications/components/MessageThreadList";
import { listMessageThreads } from "@/domains/communications/services/communications.service";
import { listGuests } from "@/domains/guests/services/guests.service";
import { listProperties } from "@/domains/properties/services/properties.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function CommunicationsPage() {
  const actor = await getCurrentUser();
  const [threads, properties, guests] = await Promise.all([
    listMessageThreads(actor),
    listProperties(actor),
    listGuests(actor),
  ]);

  return (
    <div>
      <PageHeader
        title="Communications"
        subtitle={`${threads.length} ${threads.length === 1 ? "thread" : "threads"}`}
        actions={
          <DialogTrigger label="New thread" title="Start a new thread">
            <CreateMessageThreadForm properties={properties} guests={guests} />
          </DialogTrigger>
        }
      />
      <MessageThreadList threads={threads} />
    </div>
  );
}
