"use client";

import { Button, Dialog } from "@stayw/ui";
import { ClipboardPen } from "lucide-react";
import { useActionState, useState } from "react";

import type { LockVerificationEvidenceActionState } from "../actions";
import {
  OPS_EVIDENCE_METHOD_LABELS,
  OPS_EVIDENCE_OUTCOME_LABELS,
  OPS_METHODS_BY_STEP,
  VERIFICATION_STEP_LABELS,
  type OpsEvidenceMethod,
  type OpsEvidenceOutcome,
  type VerificationStep,
} from "../lib/lock-verification-evidence";

const INITIAL_STATE: LockVerificationEvidenceActionState = { status: "idle" };

export type RecordEvidenceAction = (
  prevState: LockVerificationEvidenceActionState,
  formData: FormData,
) => Promise<LockVerificationEvidenceActionState>;

const STEPS = Object.keys(VERIFICATION_STEP_LABELS) as VerificationStep[];
const OUTCOMES = Object.keys(
  OPS_EVIDENCE_OUTCOME_LABELS,
) as OpsEvidenceOutcome[];

/** datetime-local value (viewer's local time) → ISO instant, or "" when empty/invalid. */
function localToIso(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/**
 * Admin form to record Ops verification evidence for one lock (2026-09-30).
 * Records a new audit row only — it NEVER sends a Lock/Unlock or test
 * command, and it can't make a lock "Verified": an onsite August-app test is
 * stored as "Ops-confirmed via August app", separate from the StayWhile
 * control path. Shown only to `locks:manage` holders; the server re-checks.
 */
export function RecordVerificationEvidenceButton({
  smartDeviceId,
  lockName,
  propertyName,
  action,
}: {
  smartDeviceId: string;
  lockName: string;
  propertyName: string;
  action: RecordEvidenceAction;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<VerificationStep>("REMOTE_LOCK");
  const [method, setMethod] = useState<OpsEvidenceMethod>("AUGUST_APP_ONSITE");
  const [performedAtLocal, setPerformedAtLocal] = useState("");
  const done = state.status === "success";
  const methods = OPS_METHODS_BY_STEP[step];

  function chooseStep(next: VerificationStep) {
    setStep(next);
    if (!OPS_METHODS_BY_STEP[next].includes(method)) {
      setMethod(OPS_METHODS_BY_STEP[next][0]!);
    }
  }

  function handleClose() {
    if (isPending) return;
    setOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
      >
        <ClipboardPen className="h-3.5 w-3.5" />
        Record evidence
      </Button>
      <Dialog
        open={open}
        onClose={handleClose}
        title="Record Ops verification evidence"
      >
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="smartDeviceId" value={smartDeviceId} />
          <input
            type="hidden"
            name="performedAt"
            value={localToIso(performedAtLocal)}
          />
          <p className="text-sm text-ink">
            <span className="font-medium">{propertyName}</span> — {lockName}
          </p>
          <p className="text-sm text-ink-muted">
            Records what Ops checked onsite. No command is sent to the lock. An
            August-app test is recorded as &ldquo;Ops-confirmed via August
            app&rdquo; — it does not prove StayWhile&apos;s own remote control,
            and it does not mark the lock Verified.
          </p>
          <fieldset
            className="grid gap-3 text-sm sm:grid-cols-2"
            disabled={done}
          >
            <label className="space-y-1">
              <span className="text-ink-muted">Step</span>
              <select
                name="step"
                value={step}
                onChange={(e) => chooseStep(e.target.value as VerificationStep)}
                className="w-full rounded-md border border-border px-2 py-1"
              >
                {STEPS.map((s) => (
                  <option key={s} value={s}>
                    {VERIFICATION_STEP_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-ink-muted">Result</span>
              <select
                name="outcome"
                defaultValue="PASSED"
                className="w-full rounded-md border border-border px-2 py-1"
              >
                {OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {OPS_EVIDENCE_OUTCOME_LABELS[o]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-ink-muted">Method</span>
              <select
                name="method"
                value={method}
                onChange={(e) => setMethod(e.target.value as OpsEvidenceMethod)}
                className="w-full rounded-md border border-border px-2 py-1"
              >
                {methods.map((m) => (
                  <option key={m} value={m}>
                    {OPS_EVIDENCE_METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-ink-muted">Checked by (required)</span>
              <input
                type="text"
                name="performedBy"
                maxLength={120}
                className="w-full rounded-md border border-border px-2 py-1"
                placeholder="e.g. Ops team member's name"
              />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-ink-muted">
                When it was checked (your local time, required)
              </span>
              <input
                type="datetime-local"
                value={performedAtLocal}
                onChange={(e) => setPerformedAtLocal(e.target.value)}
                className="w-full rounded-md border border-border px-2 py-1"
              />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-ink-muted">
                Notes (required unless the result is Passed)
              </span>
              <textarea
                name="notes"
                maxLength={1000}
                rows={3}
                className="w-full rounded-md border border-border px-2 py-1"
                placeholder="What was seen or done onsite"
              />
            </label>
          </fieldset>
          {!isPending && state.status !== "idle" && (
            <p
              className={`text-xs ${done ? "text-success-600" : "text-error-500"}`}
              aria-live="polite"
            >
              {done ? "Evidence recorded." : state.reason}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleClose}
              disabled={isPending}
            >
              {done ? "Close" : "Cancel"}
            </Button>
            {!done && (
              <Button type="submit" variant="primary" disabled={isPending}>
                {isPending ? "Saving…" : "Record evidence"}
              </Button>
            )}
          </div>
        </form>
      </Dialog>
    </>
  );
}
