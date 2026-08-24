import { Button, EmptyState, PageHeader } from "@stayw/ui";
import { PlugZap } from "lucide-react";

import { syncLinkedOwnerRezPropertiesAction } from "@/domains/properties/actions";
import { OwnerRezMatchReview } from "@/domains/properties/components/OwnerRezMatchReview";
import { matchOwnerRezProperties } from "@/domains/properties/services/ownerrez-sync.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function OwnerRezSyncPage() {
  const actor = await getCurrentUser();
  const result = await matchOwnerRezProperties(actor);

  return (
    <div>
      <PageHeader
        title="OwnerRez Property Sync"
        subtitle="Live match report against OwnerRez's real property list. Nothing is linked automatically — confirm each proposed match explicitly."
        actions={
          result.configured ? (
            <form action={syncLinkedOwnerRezPropertiesAction}>
              <Button type="submit" variant="secondary" size="sm">
                Sync linked properties
              </Button>
            </form>
          ) : undefined
        }
      />
      {result.configured ? (
        <OwnerRezMatchReview report={result.report} />
      ) : (
        <EmptyState
          icon={PlugZap}
          title="OwnerRez isn't configured"
          description="Set OWNERREZ_USERNAME and OWNERREZ_API_TOKEN to enable the live property match report."
        />
      )}
    </div>
  );
}
