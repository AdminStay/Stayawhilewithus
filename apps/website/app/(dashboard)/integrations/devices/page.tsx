import { Button, PageHeader } from "@stayw/ui";

import { listProperties } from "@/domains/properties/services/properties.service";
import { discoverNestDevicesAction } from "@/domains/smart-devices/actions";
import { DiscoveredDevicesList } from "@/domains/smart-devices/components/DiscoveredDevicesList";
import { listDiscoveredDevices } from "@/domains/smart-devices/services/provider-devices.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function DiscoveredDevicesPage() {
  const actor = await getCurrentUser();
  const [devices, properties] = await Promise.all([
    listDiscoveredDevices(actor),
    listProperties(actor),
  ]);

  return (
    <div>
      <PageHeader
        title="Discovered Devices"
        subtitle="Devices a connected provider's API reports — review and explicitly map each one to a property before it appears anywhere else. Nothing here is mapped or enabled automatically."
      />

      <form action={discoverNestDevicesAction} className="mb-6">
        <Button type="submit" variant="primary" size="sm">
          Discover Nest devices
        </Button>
      </form>

      <DiscoveredDevicesList devices={devices} properties={properties} />
    </div>
  );
}
