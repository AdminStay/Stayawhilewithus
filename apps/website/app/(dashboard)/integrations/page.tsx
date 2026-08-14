import { PageHeader } from "@stayw/ui";

import { IntegrationConnectionList } from "@/domains/integrations/components/IntegrationConnectionList";
import { listIntegrationConnections } from "@/domains/integrations/services/integrations.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function IntegrationsPage() {
  const actor = await getCurrentUser();
  const connections = await listIntegrationConnections(actor);
  const connectedCount = connections.filter(
    (c) => c.status === "CONNECTED",
  ).length;

  return (
    <div>
      <PageHeader
        title="Integrations"
        subtitle={`${connectedCount} of ${connections.length} providers connected`}
      />
      <IntegrationConnectionList connections={connections} />
    </div>
  );
}
