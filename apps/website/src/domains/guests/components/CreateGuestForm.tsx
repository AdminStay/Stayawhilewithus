import { Button, FormField, Input, Textarea } from "@stayw/ui";

import { createGuestAction } from "../actions";

export function CreateGuestForm() {
  return (
    <form action={createGuestAction} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <FormField label="First name" htmlFor="firstName">
          <Input id="firstName" name="firstName" required />
        </FormField>
        <FormField label="Last name" htmlFor="lastName">
          <Input id="lastName" name="lastName" required />
        </FormField>
      </div>
      <FormField label="Email" htmlFor="email" description="Optional">
        <Input id="email" name="email" type="email" />
      </FormField>
      <FormField label="Phone" htmlFor="phone" description="Optional">
        <Input id="phone" name="phone" />
      </FormField>
      <FormField label="Notes" htmlFor="notes" description="Optional">
        <Textarea id="notes" name="notes" />
      </FormField>
      <Button type="submit" className="w-full">
        Add guest
      </Button>
    </form>
  );
}
