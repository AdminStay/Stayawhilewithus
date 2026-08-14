import { Button, FormField, Input, Select } from "@stayw/ui";

import { createPropertyAction } from "../actions";

export function CreatePropertyForm() {
  return (
    <form action={createPropertyAction} className="space-y-4">
      <FormField label="Name" htmlFor="name">
        <Input id="name" name="name" required />
      </FormField>
      <FormField label="Internal code" htmlFor="internalCode">
        <Input id="internalCode" name="internalCode" required />
      </FormField>
      <FormField label="Address line 1" htmlFor="addressLine1">
        <Input id="addressLine1" name="addressLine1" required />
      </FormField>
      <div className="grid grid-cols-3 gap-3">
        <FormField label="City" htmlFor="city">
          <Input id="city" name="city" required />
        </FormField>
        <FormField label="State" htmlFor="state">
          <Input id="state" name="state" required />
        </FormField>
        <FormField label="Postal code" htmlFor="postalCode">
          <Input id="postalCode" name="postalCode" required />
        </FormField>
      </div>
      <FormField label="Country" htmlFor="country">
        <Input id="country" name="country" required />
      </FormField>
      <FormField label="Property type" htmlFor="propertyType">
        <Select
          id="propertyType"
          name="propertyType"
          required
          defaultValue="HOUSE"
        >
          <option value="HOUSE">House</option>
          <option value="APARTMENT">Apartment</option>
          <option value="CONDO">Condo</option>
          <option value="CABIN">Cabin</option>
          <option value="OTHER">Other</option>
        </Select>
      </FormField>
      <div className="grid grid-cols-3 gap-3">
        <FormField label="Bedrooms" htmlFor="bedroomCount">
          <Input
            id="bedroomCount"
            name="bedroomCount"
            type="number"
            min={0}
            required
          />
        </FormField>
        <FormField label="Bathrooms" htmlFor="bathroomCount">
          <Input
            id="bathroomCount"
            name="bathroomCount"
            type="number"
            min={0}
            step={0.5}
            required
          />
        </FormField>
        <FormField label="Max occupancy" htmlFor="maxOccupancy">
          <Input
            id="maxOccupancy"
            name="maxOccupancy"
            type="number"
            min={1}
            required
          />
        </FormField>
      </div>
      <FormField
        label="Timezone"
        htmlFor="timezone"
        description="e.g. America/Denver"
      >
        <Input id="timezone" name="timezone" required />
      </FormField>
      <Button type="submit" className="w-full">
        Create property
      </Button>
    </form>
  );
}
