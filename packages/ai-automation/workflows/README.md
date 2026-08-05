# n8n workflow exports

Exported n8n workflow JSON lives here, one file per workflow, named to match the `workflowName` passed to `triggerWorkflow()` (e.g. `property.created.json` for the `property.created` event).

## Convention

- File name = webhook path segment used in `${N8N_BASE_URL}/webhook/<workflowName>`.
- Each workflow's first node must verify the `x-staywhile-signature` HMAC header (see `packages/ai-automation/src/hmac.ts` for the algorithm: HMAC-SHA256 over the raw JSON body, hex-encoded).
- Re-export the workflow JSON here after every change in the n8n editor so it's versioned alongside the code that triggers it.
- No workflows are exported yet — this phase only wires the trigger/callback plumbing; individual workflows are added alongside each integration in later phases.
