import { PageHeaderSkeleton, Skeleton } from "@stayw/ui";

export default function Loading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-card border border-border bg-surface p-6 shadow-card"
          >
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-3 h-10 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
