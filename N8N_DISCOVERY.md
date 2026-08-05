# n8n Deep Discovery

> Architecture-level only. Login/billing email, credential names, and secrets are tracked (as placeholders) in `SECURE_CONFIGURATION_CHECKLIST.md`, not here.

**Status:** Inspected via n8n MCP tools on 2026-08-06. Instance is effectively empty — safe to build on without risk of duplicating or colliding with prior work.

| Question                         | Answer                                                                                                                                                                                                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Already configured?              | Yes — n8n Cloud account connected via MCP, but contains no real workflows yet                                                                                                                                                                                                                                  |
| Cloud or self-hosted?            | Cloud (`adminstay.app.n8n.cloud`)                                                                                                                                                                                                                                                                              |
| Workspace name                   | Personal project: `Kenny Pham <admin@stayawhilewithus.com>` (project id `9oqrqH9u5eDdTDmn`). No team projects in use; team projects are enabled on the plan but unused.                                                                                                                                        |
| Existing workflows (count/names) | **1**: "My workflow" (id `p9AsCYI5THw1oVLX`) — n8n's auto-generated default scaffold. Inactive, 0 triggers configured, never published. Contents: a Manual Trigger node ("When clicking 'Execute workflow'") connected to a single unconfigured HTTP Request node. No real logic. Not tagged, not in a folder. |
| Existing webhooks                | None                                                                                                                                                                                                                                                                                                           |
| Existing scheduled jobs          | None                                                                                                                                                                                                                                                                                                           |
| Connected services               | None beyond the 3 credentials below                                                                                                                                                                                                                                                                            |
| Connected APIs                   | None (the HTTP Request node in "My workflow" has no URL/auth configured)                                                                                                                                                                                                                                       |
| Connected AI providers           | **Anthropic** — credential `Anthropic account` (id `Ph9v2UVrg9emwwyh`, type `anthropicApi`) exists but is not wired into any workflow yet                                                                                                                                                                      |
| Connected MCP Servers            | None configured inside n8n itself (n8n is reached _from_ Claude Code via MCP; n8n does not appear to call out to any MCP servers of its own yet)                                                                                                                                                               |
| Production workflows             | None                                                                                                                                                                                                                                                                                                           |
| Experimental workflows           | None (the one workflow present is the unmodified default template)                                                                                                                                                                                                                                             |

## Credentials on file (names/types only — no secrets)

| Name                | Type             | Project               |
| ------------------- | ---------------- | --------------------- |
| Notion account      | `notionApi`      | personal (Kenny Pham) |
| Anthropic account   | `anthropicApi`   | personal (Kenny Pham) |
| Header Auth account | `httpHeaderAuth` | personal (Kenny Pham) |

No OwnerRez, Slack, Asana, Gmail, Google Voice, or smart-device (Yale/August/Nest/Ecobee/Cielo) credentials exist in n8n yet — matches `SECURE_CONFIGURATION_CHECKLIST.md`'s all-placeholder state.

## Dependency Map

Not applicable yet — no workflow has any real node-to-service dependency. Will be built out as real workflows are added.

## Notes

- **Safe to build fresh**: since nothing beyond the default template exists, new workflows do not risk duplicating or colliding with prior automation. The default "My workflow" scaffold can be left alone, repurposed, or deleted without losing anything — it holds no configured logic.
- Tags: none defined instance-wide (`list_tags` returned empty) — tagging convention for new workflows is still open to decide (e.g. by domain: `reservations`, `guests`, `communications`).
- This directly resolves the "n8n's existing state is completely unknown" risk flagged in `HANDOFF.md` — it is now known, and it is empty.
