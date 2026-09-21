"use client";

import { Button, FormField, Input, Select, Textarea } from "@stayw/ui";
import { useActionState } from "react";

import { CATEGORY_LABELS } from "./category-labels";
import type { ResourceLinkFormState } from "../actions";
import { RESOURCE_LINK_CATEGORIES } from "../schemas/resource-links.schema";

import type { ResourceLink } from "../services/resource-links.service";

const INITIAL_STATE: ResourceLinkFormState = { status: "idle" };

export function EditResourceLinkForm({
  resourceLink,
  properties,
  action,
}: {
  resourceLink: ResourceLink;
  properties: Array<{ id: string; name: string }>;
  /** See CreateResourceLinkForm's own doc comment on why this is a prop, not a direct import. */
  action: (
    prevState: ResourceLinkFormState,
    formData: FormData,
  ) => Promise<ResourceLinkFormState>;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={resourceLink.id} />
      <FormField label="Name" htmlFor="edit-name">
        <Input
          id="edit-name"
          name="name"
          defaultValue={resourceLink.name}
          required
        />
      </FormField>
      <FormField label="URL" htmlFor="edit-url">
        <Input
          id="edit-url"
          name="url"
          type="url"
          defaultValue={resourceLink.url}
          required
        />
      </FormField>
      <FormField
        label="Description"
        htmlFor="edit-description"
        description="Optional"
      >
        <Textarea
          id="edit-description"
          name="description"
          defaultValue={resourceLink.description ?? ""}
        />
      </FormField>
      <FormField label="Category" htmlFor="edit-category">
        <Select
          id="edit-category"
          name="category"
          defaultValue={resourceLink.category}
        >
          {RESOURCE_LINK_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABELS[category]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        label="Property"
        htmlFor="edit-propertyId"
        description="Optional"
      >
        <Select
          id="edit-propertyId"
          name="propertyId"
          defaultValue={resourceLink.propertyId ?? ""}
        >
          <option value="">No property (global)</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </FormField>

      {state.status === "validation_error" && (
        <p className="text-xs text-warning-700">{state.message}</p>
      )}
      {state.status === "error" && (
        <p className="text-xs text-error-500">{state.message}</p>
      )}
      {state.status === "success" && (
        <p className="text-xs text-success-600">Changes saved.</p>
      )}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
