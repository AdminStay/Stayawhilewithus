import { PageHeaderSkeleton, Skeleton } from "@stayw/ui";

export default function Loading() {
  return (
    <div>
      <PageHeaderSkeleton />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border shadow-card sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2 bg-surface p-5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-7 w-20" />
          </div>
        ))}
      </div>

      <div className="mt-10 grid gap-x-10 gap-y-10 lg:grid-cols-3">
        <div className="space-y-10 lg:col-span-2">
          <div>
            <Skeleton className="h-5 w-32" />
            <div className="mt-4 space-y-3 border-t border-border pt-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          </div>
          <div>
            <Skeleton className="h-4 w-28" />
            <div className="mt-4 space-y-3 border-t border-border pt-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-10">
          <Skeleton className="h-16" />
          {Array.from({ length: 4 }).map((_, section) => (
            <div key={section}>
              <Skeleton className="h-4 w-28" />
              <div className="mt-4 space-y-3 border-t border-border pt-3">
                {Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
