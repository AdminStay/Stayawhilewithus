# @stayw/ai

The AI platform layer: a Claude tool-use orchestrator, distinct from `@stayw/ai-automation` (deterministic n8n workflow triggers). n8n and the Orchestrator are peers — the Orchestrator can call `triggerWorkflow()` as a registered tool in a later phase, not wired yet. Depends only on `@stayw/database`; never on `@stayw/integrations` (tool handlers wrapping integration clients are the app/domain layer's job, keeping this package provider-agnostic). See ADR-0007.

## Components

| Component                 | Status                                     | Files                                            |
| ------------------------- | ------------------------------------------ | ------------------------------------------------ |
| Context Engine            | real                                       | `context/{types,registry}.ts`                    |
| Knowledge Retrieval       | stub — `NotImplementedError`               | `knowledge/{types,retriever}.ts`                 |
| Prompt Library            | real                                       | `prompts/{types,registry}.ts`                    |
| Tool Registry             | real                                       | `tools/{types,registry}.ts`                      |
| Orchestrator              | real plumbing, stub Claude call            | `orchestrator/{types,claude-client,run-turn}.ts` |
| Conversation Context      | real, against `AiConversation`/`AiMessage` | `conversations/{types,repository}.ts`            |
| Action Approval Framework | real, against `AiAction`                   | `actions/{types,errors,approval}.ts`             |

## Registering a tool

```ts
import { registerTool } from "@stayw/ai";
import { z } from "zod";

registerTool({
  name: "properties.list",
  description: "Lists active properties",
  inputSchema: z.object({}),
  requiresApproval: false,
  handler: async (_input, ctx) => listProperties(ctx),
});
```

Tools registered with `requiresApproval: true` never run their handler directly — `executeTool()` proposes an `AiAction` instead and returns `{ status: "pending_approval", actionId }`. A human then calls `approveAction()`/`rejectAction()` from the Action Approval Framework.

## Action state machine

```
PENDING -> APPROVED -> EXECUTED
        -> REJECTED     -> EXECUTION_FAILED
```

`approveAction`/`rejectAction`/`markActionExecuted`/`markActionFailed` all guard on the action's current status and throw `InvalidActionStateError` on a mismatch — see `actions/approval.ts`.

See `03 Documentation/adr/0007-ai-platform-layer.md` for the design rationale.
