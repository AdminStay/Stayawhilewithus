import { Button, FormField, Input, Select, Textarea } from "@stayw/ui";

import { createReservationAction } from "../actions";

export function CreateReservationForm({
  properties,
  guests,
}: {
  properties: Array<{ id: string; name: string }>;
  guests: Array<{ id: string; firstName: string; lastName: string }>;
}) {
  return (
    <form action={createReservationAction} className="space-y-4">
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
      <FormField label="Guest" htmlFor="primaryGuestId">
        <Select
          id="primaryGuestId"
          name="primaryGuestId"
          required
          defaultValue=""
        >
          <option value="" disabled>
            Select guest
          </option>
          {guests.map((g) => (
            <option key={g.id} value={g.id}>
              {g.firstName} {g.lastName}
            </option>
          ))}
        </Select>
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Check-in" htmlFor="checkInDate">
          <Input id="checkInDate" name="checkInDate" type="date" required />
        </FormField>
        <FormField label="Check-out" htmlFor="checkOutDate">
          <Input id="checkOutDate" name="checkOutDate" type="date" required />
        </FormField>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <FormField label="Adults" htmlFor="adults">
          <Input
            id="adults"
            name="adults"
            type="number"
            min={1}
            defaultValue={1}
            required
          />
        </FormField>
        <FormField label="Children" htmlFor="children">
          <Input
            id="children"
            name="children"
            type="number"
            min={0}
            defaultValue={0}
          />
        </FormField>
        <FormField label="Pets" htmlFor="pets">
          <Input id="pets" name="pets" type="number" min={0} defaultValue={0} />
        </FormField>
      </div>
      <FormField label="Total amount" htmlFor="totalAmount">
        <Input
          id="totalAmount"
          name="totalAmount"
          type="number"
          min={0}
          step={0.01}
          required
        />
      </FormField>
      <FormField
        label="Special requests"
        htmlFor="specialRequests"
        description="Optional"
      >
        <Textarea id="specialRequests" name="specialRequests" />
      </FormField>
      <Button type="submit" className="w-full">
        Create reservation
      </Button>
    </form>
  );
}
