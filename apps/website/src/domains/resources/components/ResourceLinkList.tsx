import {
  Badge,
  Card,
  ConfirmButton,
  DialogTrigger,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@stayw/ui";
import { ExternalLink, Link2 } from "lucide-react";

import { deleteResourceLinkAction } from "../actions";
import type { ResourceLinkFormState } from "../actions";
import type { ResourceLink } from "../services/resource-links.service";

import { EditResourceLinkForm } from "./EditResourceLinkForm";
import { CATEGORY_LABELS } from "./category-labels";

type ResourceLinkWithProperty = ResourceLink & {
  property: { name: string } | null;
};

export function ResourceLinkList({
  resourceLinks,
  properties,
  canManage,
  updateAction,
}: {
  resourceLinks: ResourceLinkWithProperty[];
  properties: Array<{ id: string; name: string }>;
  canManage: boolean;
  /** See CreateResourceLinkForm's own doc comment on why this is threaded as a prop rather than imported directly by EditResourceLinkForm. */
  updateAction: (
    prevState: ResourceLinkFormState,
    formData: FormData,
  ) => Promise<ResourceLinkFormState>;
}) {
  if (resourceLinks.length === 0) {
    return (
      <Card noPadding>
        <EmptyState
          icon={Link2}
          title="No resources yet"
          description="Add a helpful link — an SOP, a vendor contact, or any other general operations resource — to get started."
        />
      </Card>
    );
  }

  return (
    <Table>
      <TableHead>
        <TableHeaderCell>Resource</TableHeaderCell>
        <TableHeaderCell>Category</TableHeaderCell>
        <TableHeaderCell>Property</TableHeaderCell>
        {canManage && (
          <TableHeaderCell className="text-right">Actions</TableHeaderCell>
        )}
      </TableHead>
      <TableBody>
        {resourceLinks.map((r) => (
          <TableRow key={r.id}>
            <TableCell>
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 font-medium text-ink hover:underline"
              >
                {r.name}
                <ExternalLink className="h-3.5 w-3.5 text-ink-muted" />
              </a>
              {r.description && (
                <p className="mt-1 text-xs text-ink-muted">{r.description}</p>
              )}
            </TableCell>
            <TableCell>
              <Badge tone="neutral">{CATEGORY_LABELS[r.category]}</Badge>
            </TableCell>
            <TableCell className="text-ink-muted">
              {r.property?.name ?? "Global"}
            </TableCell>
            {canManage && (
              <TableCell>
                <div className="flex items-center justify-end gap-2">
                  <DialogTrigger
                    label="Edit"
                    title="Edit resource"
                    variant="secondary"
                    showIcon={false}
                  >
                    <EditResourceLinkForm
                      resourceLink={r}
                      properties={properties}
                      action={updateAction}
                    />
                  </DialogTrigger>
                  <form action={deleteResourceLinkAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <ConfirmButton
                      type="submit"
                      variant="danger"
                      size="sm"
                      confirmMessage={`Delete "${r.name}"? This removes it from the Resources list. There is no Restore option yet — recovering it would require direct database access.`}
                    >
                      Delete
                    </ConfirmButton>
                  </form>
                </div>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
