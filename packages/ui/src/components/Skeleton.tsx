import { cx } from "../lib/cx";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cx("animate-pulse rounded-lg bg-surface-muted", className)}
      aria-hidden
    />
  );
}

/** Matches PageHeader's layout — pairs with a below-the-fold content skeleton on route loading.tsx files. */
export function PageHeaderSkeleton() {
  return (
    <div className="mb-8 flex items-end justify-between border-b border-border pb-6">
      <div>
        <Skeleton className="h-7 w-48" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      <Skeleton className="h-9 w-32" />
    </div>
  );
}

/** A generic table-shaped skeleton — rows of varying-width bars, close enough to any of this app's Table-based lists. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
      <div className="border-b border-border bg-surface-muted px-4 py-3">
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3.5">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/6" />
            <Skeleton className="ml-auto h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
