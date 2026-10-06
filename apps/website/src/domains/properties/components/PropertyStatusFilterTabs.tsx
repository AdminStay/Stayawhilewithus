import Link from "next/link";

import {
  PROPERTY_STATUS_FILTER_LABELS,
  PROPERTY_STATUS_FILTERS,
  propertyStatusFilterHref,
  type PropertyStatusFilter,
} from "../lib/property-status-filter";

/**
 * Operational / Inactive / All tabs (with counts) for /properties
 * (2026-10-07). Plain links: the URL holds the state, the server filters.
 */
export function PropertyStatusFilterTabs({
  current,
  counts,
}: {
  current: PropertyStatusFilter;
  counts: Record<PropertyStatusFilter, number>;
}) {
  return (
    <nav aria-label="Property status" className="mb-4 flex flex-wrap gap-2">
      {PROPERTY_STATUS_FILTERS.map((filter) => (
        <Link
          key={filter}
          href={propertyStatusFilterHref(filter)}
          aria-current={filter === current ? "page" : undefined}
          className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
            filter === current
              ? "bg-forest-600 text-white"
              : "bg-surface-muted text-ink-muted hover:text-ink"
          }`}
        >
          {PROPERTY_STATUS_FILTER_LABELS[filter]} ({counts[filter]})
        </Link>
      ))}
    </nav>
  );
}
