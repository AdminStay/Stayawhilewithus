import { z } from "zod";

/**
 * Ops verification evidence (2026-09-30). Recording it never sends a
 * command; the step/method pairing and "note required unless passed" are
 * re-checked in recordLockVerificationEvidence(). `performedAt` arrives as
 * an ISO instant (the form converts the recorder's local time).
 */
export const recordLockVerificationEvidenceSchema = z.object({
  smartDeviceId: z.string().uuid(),
  step: z.enum(["MAPPING", "DEVICE_STATUS", "REMOTE_LOCK", "REMOTE_UNLOCK"]),
  outcome: z.enum(["PASSED", "FAILED", "NOT_APPLICABLE"]),
  method: z.enum(["AUGUST_APP_ONSITE", "ONSITE_VISUAL"]),
  performedBy: z.string().trim().min(2).max(120),
  performedAt: z.string().min(1).pipe(z.coerce.date()),
  notes: z.string().trim().max(1000).optional(),
});
