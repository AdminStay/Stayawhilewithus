import { hasPermission } from "@stayw/auth";
import { DialogTrigger, PageHeader } from "@stayw/ui";

import {
  createResourceLinkAction,
  updateResourceLinkAction,
} from "@/domains/resources/actions";
import { listProperties } from "@/domains/properties/services/properties.service";
import { CreateResourceLinkForm } from "@/domains/resources/components/CreateResourceLinkForm";
import { ResourceLinkList } from "@/domains/resources/components/ResourceLinkList";
import { listResourceLinks } from "@/domains/resources/services/resource-links.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function ResourcesPage() {
  const actor = await getCurrentUser();
  const [resourceLinks, properties, canCreate, canManage] = await Promise.all([
    listResourceLinks(actor),
    listProperties(actor),
    hasPermission(actor, "resource_links:create"),
    hasPermission(actor, "resource_links:update"),
  ]);

  return (
    <div>
      <PageHeader
        title="Resources"
        subtitle={`${resourceLinks.length} ${resourceLinks.length === 1 ? "resource" : "resources"}`}
        actions={
          canCreate ? (
            <DialogTrigger label="Add resource" title="Add resource">
              <CreateResourceLinkForm
                properties={properties}
                action={createResourceLinkAction}
              />
            </DialogTrigger>
          ) : undefined
        }
      />
      <ResourceLinkList
        resourceLinks={resourceLinks}
        properties={properties}
        canManage={canManage}
        updateAction={updateResourceLinkAction}
      />
    </div>
  );
}
