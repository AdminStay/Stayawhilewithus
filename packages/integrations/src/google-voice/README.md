# Google Voice integration

Status: not implemented (structural stub only). **Flagged 2026-08-07: Google Voice has no official public REST API.** This looks like a planning assumption in the original integration scope (`INTEGRATION_INVENTORY.md`) that doesn't hold — there's no documented, stable endpoint set to build a real client against, unlike every other provider in this package. Worth resolving with the user (drop it, or confirm an alternative like Twilio/a Google Workspace-specific API) before spending implementation time here, independent of whether `GOOGLE_VOICE_API_KEY` ever gets set.

Capabilities: webhook, messaging.

Implements `BaseIntegrationClient` from `@stayw/integrations/core` plus the capability interfaces matching the list above (see `03 Documentation/adr/0008-integration-sdk.md`). Every capability method call should produce exactly one `IntegrationSyncLog` row once implemented (convention, not schema-enforced).
