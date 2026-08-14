import { Button, FormField, Input, Select, Textarea } from "@stayw/ui";

import { createMessageThreadAction } from "../actions";

export function CreateMessageThreadForm({
  properties,
  guests,
}: {
  properties: Array<{ id: string; name: string }>;
  guests: Array<{ id: string; firstName: string; lastName: string }>;
}) {
  return (
    <form action={createMessageThreadAction} className="space-y-4">
      <FormField label="Property" htmlFor="propertyId" description="Optional">
        <Select id="propertyId" name="propertyId" defaultValue="">
          <option value="">No linked property</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Guest" htmlFor="guestId" description="Optional">
        <Select id="guestId" name="guestId" defaultValue="">
          <option value="">No linked guest</option>
          {guests.map((g) => (
            <option key={g.id} value={g.id}>
              {g.firstName} {g.lastName}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Subject" htmlFor="subject" description="Optional">
        <Input id="subject" name="subject" />
      </FormField>
      <FormField label="Message" htmlFor="body">
        <Textarea id="body" name="body" required rows={3} />
      </FormField>
      <Button type="submit" className="w-full">
        Start thread
      </Button>
    </form>
  );
}
