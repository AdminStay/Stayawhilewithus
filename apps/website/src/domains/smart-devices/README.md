# Smart Devices domain

Status: read-only, dashboard-facing. Backed by the real `SmartDevice`/`SmartDeviceEvent` tables (see `packages/database/prisma/schema.prisma`) — `services/smart-devices.service.ts` is a genuine, permission-checked Prisma query path, not a mock.

- **Owned model(s)**: `SmartDevice`, `SmartDeviceEvent`
- **Permission keys**: `smart_devices:read` (granted to `admin` and `ops_manager`), `smart_devices:create`/`update`/`delete`/`manage` exist in the permission catalog for future write paths but nothing currently uses them.
- **`listSmartDevices(actor)`**: every device with its property, ordered so `OFFLINE`/`ERROR` sort before `ONLINE`.
- **Battery level**: no dedicated column — not every provider/device type reports one. Read via `metadata.batteryLevel` (a plain number 0–100) using `getBatteryLevel()`/`isLowBattery()` (threshold: below 20%).

## What's real vs. not yet connected

- The `SmartDevice` rows themselves, in this environment, are seed data (`packages/database/prisma/seed.ts`) — clearly fictional, same convention as the rest of the demo dataset (properties, guests, reservations). The dashboard visibly badges them "Demo data" (see below) — it never presents seed rows as if they were live.
- **No live provider connection populates this table yet.** `packages/integrations/src/{august,cielo,ecobee,yale}/client.ts` are all still structural stubs (every method throws `NotImplementedError`) — see each package's README for why. `august/README.md` and `cielo/README.md` document the exact real auth requirements and client action needed for each.
- No create/update UI exists on purpose — the client's ask was status visibility ("do we have a lock problem right now"), not a device-management interface. `actions.ts`/`schemas/`/`components/` aren't built until an actual write path (e.g. an August webhook receiver) needs them.

## The exact contract a future sync() must satisfy

This is the whole point of finishing this domain now, ahead of real credentials: **the dashboard requires zero changes once a real August/Cielo client exists.** It only ever reads `SmartDevice` rows through `listSmartDevices()` — it has no idea whether a row came from the seed script or a real sync. A future `sync()` implementation just needs to write rows shaped like this:

```ts
await prisma.smartDevice.upsert({
  where: {
    provider_externalDeviceId: { provider: "AUGUST", externalDeviceId: <the provider's real device ID> },
  },
  update: {
    status: "ONLINE" | "OFFLINE" | "ERROR",
    metadata: { batteryLevel: <0-100, only if the provider actually reports one> },
    lastSeenAt: new Date(), // when last confirmed online
  },
  create: { propertyId: <StayWhile Property.id this device belongs to>, provider, deviceType, externalDeviceId, name, ...update },
});
```

- **`(provider, externalDeviceId)` is the real unique key** (`@@unique` in `schema.prisma`) — upsert on it, don't `create` blindly, or re-running sync duplicates devices.
- **`propertyId` mapping is on the sync implementation, not this domain** — StayWhile has no built-in concept of "this August lock belongs to this property" beyond whatever the sync code decides (e.g. matching by an address/name lookup, or a manual mapping table if fuzzy-matching isn't safe). Not designed yet; a real gap, not an oversight.
- **The "Demo data" badge disappears automatically** the moment a device's `provider` has a `"real"` entry in `apps/website/src/domains/integrations/services/integrations.service.ts`'s `PROVIDER_CLIENT_STATUS` map — `dashboard.service.ts`'s `hasLiveDeviceData` derives directly from that, per-provider. Flipping `AUGUST`/`CIELO` from `"stub"` to `"real"` there (which should happen as part of actually implementing the client, not as a separate step) is what makes the dashboard start treating that provider's devices as live.
