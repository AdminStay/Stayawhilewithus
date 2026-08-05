# AI domain

Status: not yet implemented — README skeleton only, establishing the pattern for this phase. See `03 Documentation/adr/0006-domain-driven-folder-structure.md`.

- **Owned model(s)**: `AiConversation`, `AiMessage`, `AiAction`
- **Permission keys**: `ai_conversations:read`, `ai_conversations:create`, `ai_conversations:update`, `ai_conversations:manage`, `ai_actions:read`, `ai_actions:update`
- **Expected shape when implemented**: `services/ai.service.ts`, `schemas/ai.schema.ts`, `components/`, `actions.ts`, `README.md` (this file, expanded).

**Domain vs. package split**: `packages/ai` (`@stayw/ai`) is the reusable AI platform layer (Context Engine, Prompt Library, Tool Registry, Orchestrator, Conversation Context, Action Approval Framework) — no permission checks of its own. This domain owns the business-facing feature built on top: the ops-assistant conversation UI and the pending-AI-action approval queue, with its own `assertPermission` calls. Folder name intentionally differs from the permission resource names (`ai_conversations`, `ai_actions`). See `03 Documentation/adr/0007-ai-platform-layer.md`.
