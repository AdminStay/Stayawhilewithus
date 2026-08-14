import { Button, FormField, Select, Textarea } from "@stayw/ui";

import { createMaintenanceRequestAction } from "../actions";

export function CreateMaintenanceRequestForm({
  properties,
}: {
  properties: Array<{ id: string; name: string }>;
}) {
  return (
    <form action={createMaintenanceRequestAction} className="space-y-4">
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
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Category" htmlFor="category">
          <Select
            id="category"
            name="category"
            required
            defaultValue="PLUMBING"
          >
            <option value="PLUMBING">Plumbing</option>
            <option value="ELECTRICAL">Electrical</option>
            <option value="HVAC">HVAC</option>
            <option value="APPLIANCE">Appliance</option>
            <option value="STRUCTURAL">Structural</option>
            <option value="PEST_CONTROL">Pest control</option>
            <option value="OTHER">Other</option>
          </Select>
        </FormField>
        <FormField label="Severity" htmlFor="severity">
          <Select id="severity" name="severity" required defaultValue="MEDIUM">
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="EMERGENCY">Emergency</option>
          </Select>
        </FormField>
      </div>
      <FormField label="Description" htmlFor="description">
        <Textarea
          id="description"
          name="description"
          required
          rows={3}
          placeholder="Describe the issue"
        />
      </FormField>
      <Button type="submit" className="w-full">
        Submit request
      </Button>
    </form>
  );
}
