import { hasPermission } from "@stayw/auth";
import { PageHeader } from "@stayw/ui";

import { ThermostatsList } from "@/domains/smart-devices/components/ThermostatsList";
import {
  isThermostatVisible,
  listSmartDevices,
} from "@/domains/smart-devices/services/smart-devices.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function ThermostatsPage() {
  const actor = await getCurrentUser();
  const devices = await listSmartDevices(actor);
  const thermostats = devices
    .filter((d) => d.deviceType === "THERMOSTAT")
    .filter(isThermostatVisible);

  // Resolved once per distinct property (not per device) — the real,
  // server-side answer to "can this actor actually send a Nest command for
  // this property," used only to decide whether NestThermostatControls
  // renders at all. assertPermission(actor, "thermostats:manage", ...)
  // inside sendNestThermostatCommand remains the actual enforcement,
  // unchanged — this just stops inviting a click that would be rejected.
  const uniquePropertyIds = [...new Set(thermostats.map((t) => t.propertyId))];
  const manageChecks = await Promise.all(
    uniquePropertyIds.map(
      async (propertyId) =>
        [
          propertyId,
          await hasPermission(actor, "thermostats:manage", { propertyId }),
        ] as const,
    ),
  );
  const canManageByPropertyId = Object.fromEntries(manageChecks);

  return (
    <div>
      <PageHeader
        title="Thermostats"
        subtitle="Every connected thermostat across all properties — status and reading detail."
      />
      <ThermostatsList
        thermostats={thermostats}
        canManageByPropertyId={canManageByPropertyId}
      />
    </div>
  );
}
