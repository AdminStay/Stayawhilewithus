# ADR-0008: Capability-based Integration SDK

## Status

Accepted — 2026-08-06

## Context

The original 12 provider stubs (OwnerRez, Airbnb, Slack, Asana, Notion, Gmail, Google Voice, Yale, August, Nest, Ecobee, Cielo) were generated ad hoc, each with its own shape and no shared interface. This made it impossible to write provider-agnostic code (e.g. "sync every sync-capable integration") and hid a real bug: a bulk-generation script using macOS's BSD `sed` had silently failed to uppercase `\U` in its replacement pattern, producing broken class/type names (`UownerrezClient`, `UgoogleUvoiceClient`, etc.) across all 12 providers.

## Decision

- **`packages/integrations/src/core/`**: `types.ts` defines `BaseIntegrationClient` (universal: `connect`/`disconnect`/`authenticate`/`healthCheck`/`validateCredentials`) plus four capability interfaces — `SyncCapable` (bulk pull/push), `WebhookReceivable` (inbound events), `MessagingCapable` (outbound messages), `MediaUploadCapable` (attachments) — and an `IntegrationCapability` union (`"sync" | "webhook" | "messaging" | "media-upload"`). `capabilities.ts` provides type-guard functions for safe runtime narrowing. `errors.ts` holds `NotImplementedError` (moved out of `index.ts`, which is now a pure barrel).
- Every provider declares `readonly capabilities = [...] as const` and implements exactly the capability interfaces that apply:
  | Provider                          | sync                                                    | webhook | messaging | media-upload                                           |
  | --------------------------------- | ------------------------------------------------------- | ------- | --------- | ------------------------------------------------------ |
  | OwnerRez, Airbnb                  | yes                                                     | yes     | no        | no                                                     |
  | Slack, Gmail, Google Voice        | no                                                      | yes     | yes       | no _(deferred — no attachment field on `Message` yet)_ |
  | Asana                             | yes                                                     | yes     | no        | no                                                     |
  | Notion                            | yes                                                     | no      | no        | no                                                     |
  | Yale, August, Nest, Ecobee, Cielo | yes _(periodic reconciliation alongside pushed events)_ | yes     | no        | no                                                     |
- Every method still throws `NotImplementedError` — this ADR changes the _shape_, not the implementation status. `testConnection()` is dropped, superseded by `healthCheck()` + `validateCredentials()`.
- The naming bug is corrected as part of this rewrite (`OwnerrezClient`, `GoogleVoiceClient`, etc.) since all 12 files are being touched anyway.
- **No schema changes**: `IntegrationConnection`/`IntegrationSyncLog` already generically cover the capability model. The capability-to-`IntegrationSyncLog` mapping ("every capability call produces one `IntegrationSyncLog` row") is documented as a convention in `packages/integrations/README.md`, not enforced by new columns.

## Consequences

- Code that only cares about a capability (e.g. a future "sync all sync-capable integrations" job) can depend on `SyncCapable` and the `hasCapability()` type guard instead of a specific provider's class.
- The corrected class names mean any code written against the old (buggy) names would have failed to compile — confirming nothing downstream depended on them yet, since this rewrite type-checked cleanly.
- OwnerRez's real v2 API integration is still unstarted implementation work — this ADR only changes the stub's shape, not its completeness. See `HANDOFF.md` for the credential/sandbox blockers.
- Slack/Gmail/Google Voice deliberately omit `MediaUploadCapable` for now; adding it later requires an attachment field on `Message` first — a schema change, not just an interface addition.
