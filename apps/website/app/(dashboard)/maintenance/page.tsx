import { DialogTrigger, PageHeader } from "@stayw/ui";

import { CreateMaintenanceRequestForm } from "@/domains/maintenance/components/CreateMaintenanceRequestForm";
import { MaintenanceRequestList } from "@/domains/maintenance/components/MaintenanceRequestList";
import { listMaintenanceRequests } from "@/domains/maintenance/services/maintenance.service";
import { listProperties } from "@/domains/properties/services/properties.service";
import { listAssignableUsers } from "@/domains/tasks/services/tasks.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function MaintenancePage() {
  const actor = await getCurrentUser();
  const [requests, properties, assignableUsers] = await Promise.all([
    listMaintenanceRequests(actor),
    listProperties(actor),
    listAssignableUsers(actor),
  ]);

  return (
    <div>
      <PageHeader
        title="Maintenance"
        subtitle={`${requests.length} ${requests.length === 1 ? "request" : "requests"} reported`}
        actions={
          <DialogTrigger label="Report an issue" title="Report an issue">
            <CreateMaintenanceRequestForm properties={properties} />
          </DialogTrigger>
        }
      />
      <MaintenanceRequestList
        requests={requests}
        assignableUsers={assignableUsers}
      />
    </div>
  );
}
