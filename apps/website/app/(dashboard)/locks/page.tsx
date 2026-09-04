import { hasPermission } from "@stayw/auth";
import { PageHeader } from "@stayw/ui";

import { refreshAugustAction } from "@/domains/smart-devices/actions";
import { LocksList } from "@/domains/smart-devices/components/LocksList";
import { RefreshLocksButton } from "@/domains/smart-devices/components/RefreshLocksButton";
import { listSmartDevices } from "@/domains/smart-devices/services/smart-devices.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function LocksPage() {
  const actor = await getCurrentUser();
  const devices = await listSmartDevices(actor);
  const locks = devices.filter((d) => d.deviceType === "LOCK");

  // Global (not property-scoped) — refreshAugustTelemetry()/refreshAugustAction
  // both still call assertPermission(actor, "smart_devices:update") themselves,
  // so this check is UX-only: it stops a read-only user from ever seeing a
  // button that would just fail with "ForbiddenError" on click, it doesn't
  // relax or replace the real server-side enforcement. Same pattern as
  // /thermostats' canRefresh.
  const canRefresh = await hasPermission(actor, "smart_devices:update");

  return (
    <div>
      <PageHeader
        title="Locks"
        subtitle="Every August lock across all properties — status, battery, and sync detail."
      />
      {/* Rendered directly in the page body, matching /thermostats'
          RefreshThermostatsButton placement exactly — a real,
          Production-proven position for an immediate-submit refresh form in
          this app. */}
      {canRefresh && (
        <div className="mb-6 flex justify-end">
          <RefreshLocksButton action={refreshAugustAction} />
        </div>
      )}
      <LocksList locks={locks} />
    </div>
  );
}
