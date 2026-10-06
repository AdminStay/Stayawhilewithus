import {
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  Input,
  Select,
  StatusIndicator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@stayw/ui";
import { Building2 } from "lucide-react";
import Link from "next/link";

import {
  deletePropertyAction,
  updatePropertyOccupancyAction,
  updatePropertyStatusAction,
} from "../actions";
import {
  PROPERTY_STATUS_TONE,
  propertyStatusLabel,
} from "../lib/property-status-filter";
import type { Property } from "../services/properties.service";

import { PropertyCleanerSummary } from "@/domains/cleaners/components/PropertyCleanerSummary";
import type { PropertyCleanerSummary as CleanerSummary } from "@/domains/cleaners/services/cleaner-assignments.service";
import { OwnerRezLink } from "@/domains/integrations/components/OwnerRezLink";
import { ownerRezPropertyUrl } from "@/domains/integrations/lib/ownerrez-links";

const STATUSES = ["ACTIVE", "INACTIVE", "ONBOARDING", "OFFBOARDED"] as const;

export function PropertyList({
  properties,
  cleanerSummaries = null,
  emptyTitle = "No properties yet",
  emptyDescription = "Add your first property to get started.",
}: {
  properties: Property[];
  /** propertyId → current cleaners; null hides the Cleaner column (no cleaners:read). */
  cleanerSummaries?: Record<string, CleanerSummary> | null;
  /** Empty-state copy — /properties passes status-filter-specific text (2026-10-07). */
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (properties.length === 0) {
    return (
      <Card noPadding>
        <EmptyState
          icon={Building2}
          title={emptyTitle}
          description={emptyDescription}
        />
      </Card>
    );
  }

  return (
    <Table>
      <TableHead>
        <TableHeaderCell>Property</TableHeaderCell>
        <TableHeaderCell>Location</TableHeaderCell>
        <TableHeaderCell>Status</TableHeaderCell>
        {cleanerSummaries && <TableHeaderCell>Cleaner</TableHeaderCell>}
        <TableHeaderCell>Max occupancy</TableHeaderCell>
        <TableHeaderCell className="text-right">Actions</TableHeaderCell>
      </TableHead>
      <TableBody>
        {properties.map((p) => (
          <TableRow key={p.id}>
            <TableCell>
              <span className="font-medium text-ink">{p.name}</span>
              <span className="ml-2 text-ink-muted">({p.internalCode})</span>
              {ownerRezPropertyUrl(p.ownerRezPropertyId) && (
                <OwnerRezLink
                  href={ownerRezPropertyUrl(p.ownerRezPropertyId)!}
                  label="Open in OwnerRez"
                  title={`Open ${p.name} in OwnerRez`}
                />
              )}
            </TableCell>
            <TableCell className="text-ink-muted">
              {p.city}, {p.state}
            </TableCell>
            <TableCell>
              <StatusIndicator
                label={propertyStatusLabel(p.status)}
                tone={PROPERTY_STATUS_TONE[p.status] ?? "neutral"}
              />
            </TableCell>
            {cleanerSummaries && (
              <TableCell>
                <Link
                  href={`/cleaners#property-${p.id}`}
                  className="hover:underline"
                  title={`Manage cleaners for ${p.name}`}
                >
                  <PropertyCleanerSummary summary={cleanerSummaries[p.id]} />
                </Link>
              </TableCell>
            )}
            <TableCell>
              <form
                action={updatePropertyOccupancyAction}
                className="flex items-center gap-1.5"
              >
                <input type="hidden" name="propertyId" value={p.id} />
                <Input
                  type="number"
                  name="maxOccupancy"
                  min={1}
                  defaultValue={p.maxOccupancy}
                  className="w-16 py-1.5 text-xs"
                />
                <Button type="submit" variant="secondary" size="sm">
                  Update
                </Button>
              </form>
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-2">
                <form
                  action={updatePropertyStatusAction}
                  className="flex items-center gap-1.5"
                >
                  <input type="hidden" name="propertyId" value={p.id} />
                  <Select
                    name="status"
                    defaultValue={p.status}
                    className="py-1.5 text-xs"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {propertyStatusLabel(s)}
                      </option>
                    ))}
                  </Select>
                  <Button type="submit" variant="secondary" size="sm">
                    Update
                  </Button>
                </form>
                <form action={deletePropertyAction}>
                  <input type="hidden" name="propertyId" value={p.id} />
                  <ConfirmButton
                    variant="danger"
                    size="sm"
                    confirmMessage={`Remove "${p.name}"? It will disappear from every list until restored.`}
                  >
                    Remove
                  </ConfirmButton>
                </form>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
