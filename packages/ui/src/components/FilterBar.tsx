import type { ReactNode } from "react";

/** Presentational row for date/filter controls — e.g. under a PageHeader or above a Table. Layout only; filtering logic belongs to the page. */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      {children}
    </div>
  );
}
