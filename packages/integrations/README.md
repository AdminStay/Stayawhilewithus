# @stayw/integrations

A capability-based Integration SDK — see `03 Documentation/adr/0008-integration-sdk.md` for the design rationale.

## Shape

Every provider client in `src/<provider>/client.ts` implements `BaseIntegrationClient` from `src/core` (`connect`, `disconnect`, `authenticate`, `healthCheck`, `validateCredentials` — universal across all providers) plus whichever capability interfaces apply, declared via a `capabilities: readonly IntegrationCapability[]` array:

- `SyncCapable` (`sync()`) — bulk pull/push (reservation sync, device-state reconciliation).
- `WebhookReceivable` (`receiveWebhook()`) — provider pushes events to us.
- `MessagingCapable` (`sendMessage()`) — outbound SMS/chat/email.
- `MediaUploadCapable` (`uploadMedia()`) — not yet used by any provider (no attachment field on `Message` yet).

Use the type guards (`isSyncCapable`, `isWebhookReceivable`, `isMessagingCapable`, `isMediaUploadCapable` from `src/core`) to safely narrow a `BaseIntegrationClient` before calling a capability-specific method — don't cast.

`src/core/` also holds the shared HTTP client (retry/backoff, timeout) and generic HMAC webhook signature verification reused across providers.

## Capability matrix

| Provider                          | sync | webhook | messaging | media-upload |
| --------------------------------- | ---- | ------- | --------- | ------------ |
| OwnerRez, Airbnb                  | ✓    | ✓       |           |              |
| Asana                             | ✓    | ✓       |           |              |
| Notion                            | ✓    |         |           |              |
| Slack, Gmail, Google Voice        |      | ✓       | ✓         |              |
| Yale, August, Nest, Ecobee, Cielo | ✓    | ✓       |           |              |

## Convention

`IntegrationConnection`/`IntegrationSyncLog` (see `schema.prisma`) have no capability-specific columns — every capability method call should produce exactly one `IntegrationSyncLog` row (`direction: OUTBOUND` for `sync`/`sendMessage`/`uploadMedia`, `direction: INBOUND` for `receiveWebhook`) once a provider is actually implemented. This is a documented convention, not schema-enforced.

This phase only scaffolds structure — every `client.ts` throws `NotImplementedError` from its methods. Live implementations are added incrementally starting with Reservation Management (OwnerRez) in a later phase.
