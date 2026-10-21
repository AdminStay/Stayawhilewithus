import { PageHeader } from "@stayw/ui";

import { IntegrationConnectionList } from "@/domains/integrations/components/IntegrationConnectionList";
import { listIntegrationConnections } from "@/domains/integrations/services/integrations.service";
import { getAugustTokenExpiry } from "@/domains/smart-devices/services/august-token-expiry.service";
import { getAugustAuthFailedAt } from "@/domains/smart-devices/services/lock-refresh.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function IntegrationsPage() {
  const actor = await getCurrentUser();
  const connections = await listIntegrationConnections(actor);
  // 2026-10-21: August refused the sign-in and nothing has succeeded since.
  const augustAuthFailedAt = await getAugustAuthFailedAt(actor);
  // 2026-10-21: login expiry from the non-secret AUGUST_TOKEN_EXPIRES_AT.
  const augustTokenExpiry = await getAugustTokenExpiry(
    actor,
    "integrations:read",
  );
  const connectedCount = connections.filter(
    (c) => c.status === "CONNECTED",
  ).length;

  return (
    <div>
      <PageHeader
        title="Integrations"
        subtitle={`${connectedCount} of ${connections.length} providers connected`}
      />
      <IntegrationConnectionList
        connections={connections}
        augustAuthFailedAt={augustAuthFailedAt}
        augustTokenExpiry={augustTokenExpiry}
      />
    </div>
  );
}
