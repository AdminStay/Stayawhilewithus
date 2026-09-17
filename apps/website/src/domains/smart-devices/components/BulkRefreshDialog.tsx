"use client";

import { Button, Dialog } from "@stayw/ui";
import { ListChecks } from "lucide-react";
import { useState } from "react";

import type { RefreshAugustBatchActionState } from "../actions";

import {
  LockBulkRefreshPanel,
  type BulkRefreshRow,
} from "./LockBulkRefreshPanel";

/**
 * Header-area trigger + modal for the existing LockBulkRefreshPanel
 * (2026-09-18 /locks UI cleanup) — the panel's own 42-row checklist used to
 * sit permanently expanded on the page body; it now only exists inside
 * this Dialog, opened on demand. No functional change to selection,
 * batching (MAX_IDS_PER_BATCH), per-group confirmation, or refresh safety —
 * this file only decides when the existing UI is visible, never what it
 * does. `size="lg"` gives the checklist a bit more room than the default
 * confirmation-dialog width; Dialog's own `max-h-[70vh]` body scroll
 * already handles a 42-row list without growing past the viewport.
 */
export function BulkRefreshDialog({
  rows,
  action,
}: {
  rows: BulkRefreshRow[];
  action: (
    prevState: RefreshAugustBatchActionState,
    formData: FormData,
  ) => Promise<RefreshAugustBatchActionState>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
      >
        <ListChecks className="h-3.5 w-3.5" />
        Bulk refresh
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Bulk refresh telemetry"
        size="lg"
      >
        <LockBulkRefreshPanel rows={rows} action={action} />
      </Dialog>
    </>
  );
}
