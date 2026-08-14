import { Button, FormField, Input, Select } from "@stayw/ui";

import { createCleaningScheduleAction } from "../actions";

export function CreateCleaningScheduleForm({
  properties,
  reservations,
}: {
  properties: Array<{ id: string; name: string }>;
  reservations: Array<{ id: string; property: { name: string } }>;
}) {
  return (
    <form action={createCleaningScheduleAction} className="space-y-4">
      <FormField label="Property" htmlFor="propertyId">
        <Select id="propertyId" name="propertyId" required defaultValue="">
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
      <Button type="submit" className="w-full">
        Schedule cleaning
      </Button>
    </form>
  );
}
