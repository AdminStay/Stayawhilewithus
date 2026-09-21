import type { RESOURCE_LINK_CATEGORIES } from "../schemas/resource-links.schema";

type ResourceLinkCategory = (typeof RESOURCE_LINK_CATEGORIES)[number];

/** Human-readable labels — shared by the create/edit forms and the list's category badge, so the wording only lives in one place. */
export const CATEGORY_LABELS: Record<ResourceLinkCategory, string> = {
  SOP: "SOP",
  VENDOR: "Vendor / Service Provider",
  OPERATIONS: "Operations",
  EMERGENCY: "Emergency",
  PROPERTY: "Property",
  OTHER: "Other",
};
