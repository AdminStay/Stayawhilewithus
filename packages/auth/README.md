# @stayw/auth

Framework-agnostic RBAC engine. Clerk handles identity only; this package is the sole source of authorization decisions, enforced in the service layer (`apps/website/src/server/services/**`), never in middleware.

```ts
import { assertPermission } from "@stayw/auth";

export async function createProperty(
  actor: AuthContext,
  input: CreatePropertyInput,
) {
  await assertPermission(actor, "properties:create");
  // ...
}
```

Property-scoped check:

```ts
await assertPermission(actor, "tasks:update", { propertyId: task.propertyId });
```

See `03 Documentation/adr/0004-authentication-and-rbac-strategy.md` for the design rationale.
