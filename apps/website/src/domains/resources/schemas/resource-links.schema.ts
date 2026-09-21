import { z } from "zod";

export const RESOURCE_LINK_CATEGORIES = [
  "SOP",
  "VENDOR",
  "OPERATIONS",
  "EMERGENCY",
  "PROPERTY",
  "OTHER",
] as const;

/**
 * `.url()` alone accepts any scheme the WHATWG URL parser recognizes,
 * including `javascript:`/`data:` — this restricts stored links to the two
 * schemes the dashboard actually opens in a new tab, so a malicious/typo'd
 * link can never become a stored XSS vector.
 */
function isHttpOrHttps(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const resourceLinkFields = {
  name: z.string().trim().min(1).max(200),
  url: z
    .string()
    .trim()
    .max(2048)
    .url()
    .refine(isHttpOrHttps, "URL must start with http:// or https://"),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  category: z.enum(RESOURCE_LINK_CATEGORIES).default("OTHER"),
  propertyId: z.string().uuid().optional().or(z.literal("")),
};

export const createResourceLinkSchema = z.object(resourceLinkFields);
export type CreateResourceLinkInput = z.infer<typeof createResourceLinkSchema>;

export const updateResourceLinkSchema = z.object({
  id: z.string().uuid(),
  ...resourceLinkFields,
});
export type UpdateResourceLinkInput = z.infer<typeof updateResourceLinkSchema>;

export const deleteResourceLinkSchema = z.object({
  id: z.string().uuid(),
});
export type DeleteResourceLinkInput = z.infer<typeof deleteResourceLinkSchema>;
