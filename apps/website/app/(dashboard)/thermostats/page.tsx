import { PageHeader } from "@stayw/ui";

import { ThermostatsList } from "@/domains/smart-devices/components/ThermostatsList";
import { listSmartDevices } from "@/domains/smart-devices/services/smart-devices.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function ThermostatsPage() {
  const actor = await getCurrentUser();
  const devices = await listSmartDevices(actor);
  const thermostats = devices.filter((d) => d.deviceType === "THERMOSTAT");

  return (
    <div>
      <PageHeader
        title="Thermostats"
        subtitle="Every connected thermostat across all properties — status and reading detail."
      />
      <ThermostatsList thermostats={thermostats} />
    </div>
  );
}
