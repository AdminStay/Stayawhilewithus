import { Button, FormField, Input, Select, Textarea } from "@stayw/ui";

import { createTaskAction } from "../actions";

export function CreateTaskForm({
  properties,
}: {
  properties: Array<{ id: string; name: string }>;
}) {
  return (
    <form action={createTaskAction} className="space-y-4">
      <FormField label="Title" htmlFor="title">
        <Input id="title" name="title" required />
      </FormField>
      <FormField
        label="Description"
        htmlFor="description"
        description="Optional"
      >
        <Textarea id="description" name="description" />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Type" htmlFor="type">
          <Select id="type" name="type" required defaultValue="GENERAL">
            <option value="GENERAL">General</option>
            <option value="CLEANING">Cleaning</option>
            <option value="MAINTENANCE">Maintenance</option>
            <option value="INSPECTION">Inspection</option>
          </Select>
        </FormField>
        <FormField label="Priority" htmlFor="priority">
          <Select id="priority" name="priority" defaultValue="NORMAL">
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </Select>
        </FormField>
      </div>
      <FormField label="Property" htmlFor="propertyId" description="Optional">
        <Select id="propertyId" name="propertyId" defaultValue="">
          <option value="">No property</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Due date" htmlFor="dueAt" description="Optional">
        <Input id="dueAt" name="dueAt" type="date" />
      </FormField>
      <Button type="submit" className="w-full">
        Add task
      </Button>
    </form>
  );
}
