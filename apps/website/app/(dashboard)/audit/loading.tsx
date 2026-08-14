import { PageHeaderSkeleton, TableSkeleton } from "@stayw/ui";

export default function Loading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <TableSkeleton />
      <div className="mt-8">
        <TableSkeleton rows={3} />
      </div>
    </div>
  );
}
