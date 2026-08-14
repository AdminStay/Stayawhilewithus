import { PageHeaderSkeleton, Skeleton } from "@stayw/ui";

export default function Loading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <div className="flex gap-6">
        <Skeleton className="h-96 w-64 shrink-0" />
        <Skeleton className="h-96 flex-1" />
      </div>
    </div>
  );
}
