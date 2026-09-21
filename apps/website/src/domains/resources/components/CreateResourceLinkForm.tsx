"use client";

import { Button, FormField, Input, Select, Textarea } from "@stayw/ui";
import { useActionState } from "react";

import { CATEGORY_LABELS } from "./category-labels";
import type { ResourceLinkFormState } from "../actions";
import { RESOURCE_LINK_CATEGORIES } from "../schemas/resource-links.schema";

const INITIAL_STATE: ResourceLinkFormState = { status: "idle" };

export function CreateResourceLinkForm({
  properties,
  action,
}: {
  properties: Array<{ id: string; name: string }>;
  /**
   * The server action itself, passed down from a Server Component rather
   * than imported directly here — same reason NotionFieldEditor.tsx takes
   * its action as a prop: actions.ts is a "use server" file Next.js's real
   * bundler specially rewrites for a client import, but a plain
   * Vite/Vitest transform doesn't replicate that, so importing the
   * function value directly here would drag the whole server-only module
   * graph into that tool's bundle.
   */
  action: (
    prevState: ResourceLinkFormState,
    formData: FormData,
  ) => Promise<ResourceLinkFormState>;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-4">
      <FormField label="Name" htmlFor="name">
        <Input id="name" name="name" required />
      </FormField>
      <FormField label="URL" htmlFor="url">
        <Input id="url" name="url" type="url" placeholder="https://" required />
      </FormField>
      <FormField
        label="Description"
        htmlFor="description"
        description="Optional"
      >
        <Textarea id="description" name="description" />
      </FormField>
      <FormField label="Category" htmlFor="category">
        <Select id="category" name="category" defaultValue="OTHER">
          {RESOURCE_LINK_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABELS[category]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Property" htmlFor="propertyId" description="Optional">
        <Select id="propertyId" name="propertyId" defaultValue="">
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
        <p className="text-xs text-success-600">Resource added.</p>
      )}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Saving…" : "Add resource"}
      </Button>
    </form>
  );
}
