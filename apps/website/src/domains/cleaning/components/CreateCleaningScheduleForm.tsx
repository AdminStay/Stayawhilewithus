"use client";

import { Button, FormField, Input, Select } from "@stayw/ui";
import { useActionState, useState } from "react";

import {
  cleanerOptionGroups,
  INITIAL_CLEANING_FORM_STATE,
  isTeamOnly,
  type CleanerOption,
  type CleaningAction,
  type PropertyCleaners,
} from "./cleaner-options";

import { FormMessage } from "@/domains/cleaners/components/FormMessage";

/**
 * Cleaner Phase 4 inputs for the form. Omitted for viewers without
 * cleaners:read: the form then has no cleaner field, and the server applies
 * the property's default (its current PRIMARY, or none).
 */
export interface CreateFormCleaners {
  propertyCleaners: Record<string, PropertyCleaners>;
  activeCleaners: CleanerOption[];
  /** Admin only — may pick a cleaner other than the property's default. */
  canChoose: boolean;
}

/** The default for a property: its current primary, never a team member. */
function defaultCleanerId(property: PropertyCleaners | undefined): string {
  return property?.primary?.id ?? "";
}

export function CreateCleaningScheduleForm({
  properties,
  reservations,
  cleaners,
  action,
}: {
  properties: Array<{ id: string; name: string }>;
  reservations: Array<{ id: string; property: { name: string } }>;
  cleaners?: CreateFormCleaners;
  action: CleaningAction;
}) {
  const [state, formAction, isPending] = useActionState(
    action,
    INITIAL_CLEANING_FORM_STATE,
  );
  const [propertyId, setPropertyId] = useState("");
  const [cleanerId, setCleanerId] = useState("");

  const propertyCleaners = cleaners?.propertyCleaners[propertyId];

  return (
    <form action={formAction} className="space-y-4">
      <FormField label="Property" htmlFor="propertyId">
        <Select
          id="propertyId"
          name="propertyId"
          required
          value={propertyId}
          onChange={(event) => {
            const next = event.target.value;
            setPropertyId(next);
            // Re-default on every property change: the new property's
            // primary, or no cleaner. A team member is never pre-selected.
            setCleanerId(defaultCleanerId(cleaners?.propertyCleaners[next]));
          }}
        >
          <option value="" disabled>
            Select property
          </option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </FormField>
      {cleaners && propertyId !== "" && (
        <CleanerField
          propertyCleaners={propertyCleaners}
          activeCleaners={cleaners.activeCleaners}
          canChoose={cleaners.canChoose}
          value={cleanerId}
          onChange={setCleanerId}
        />
      )}
      <FormField
        label="Linked reservation"
        htmlFor="reservationId"
        description="Optional"
      >
        <Select id="reservationId" name="reservationId" defaultValue="">
          <option value="">No linked reservation</option>
          {reservations.map((r) => (
            <option key={r.id} value={r.id}>
              {r.property.name} — {r.id}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Cleaning type" htmlFor="cleaningType">
        <Select
          id="cleaningType"
          name="cleaningType"
          required
          defaultValue="TURNOVER"
        >
          <option value="TURNOVER">Turnover</option>
          <option value="DEEP_CLEAN">Deep clean</option>
          <option value="INSPECTION_CLEAN">Inspection clean</option>
          <option value="MAINTENANCE_CLEAN">Maintenance clean</option>
        </Select>
      </FormField>
      <FormField label="Scheduled date" htmlFor="scheduledDate">
        <Input id="scheduledDate" name="scheduledDate" type="date" required />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField
          label="Start time"
          htmlFor="scheduledStartTime"
          description="Optional"
        >
          <Input
            id="scheduledStartTime"
            name="scheduledStartTime"
            type="time"
          />
        </FormField>
        <FormField
          label="End time"
          htmlFor="scheduledEndTime"
          description="Optional"
        >
          <Input id="scheduledEndTime" name="scheduledEndTime" type="time" />
        </FormField>
      </div>
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Scheduling…" : "Schedule cleaning"}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

/**
 * Always submits `cleanerId` explicitly ("" = no cleaner yet). An admin
 * picks from the property's primary/team and every other ACTIVE cleaner;
 * anyone else just sees (and submits) the property's default.
 */
function CleanerField({
  propertyCleaners,
  activeCleaners,
  canChoose,
  value,
  onChange,
}: {
  propertyCleaners: PropertyCleaners | undefined;
  activeCleaners: CleanerOption[];
  canChoose: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const teamOnly = isTeamOnly(propertyCleaners);
  const teamNames = (propertyCleaners?.teamMembers ?? [])
    .map((m) => m.name)
    .join(", ");
  const description = propertyCleaners?.primary
    ? `Default: ${propertyCleaners.primary.name} (current primary).`
    : teamOnly
      ? `Team: ${teamNames} — no primary. Choose one for this cleaning, or leave it as Needs cleaner.`
      : "This property has no cleaner assigned — the cleaning will need one.";

  if (!canChoose) {
    return (
      <FormField label="Cleaner" description={description}>
        <input type="hidden" name="cleanerId" value={value} />
        <p className="text-sm text-ink">
          {propertyCleaners?.primary?.name ?? "Needs cleaner"}
        </p>
      </FormField>
    );
  }

  const groups = cleanerOptionGroups(propertyCleaners, activeCleaners);
  return (
    <FormField label="Cleaner" htmlFor="cleanerId" description={description}>
      <Select
        id="cleanerId"
        name="cleanerId"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">No cleaner yet (Needs cleaner)</option>
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
    </FormField>
  );
}
