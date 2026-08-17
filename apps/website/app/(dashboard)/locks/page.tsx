import { PageHeader } from "@stayw/ui";

import { LocksList } from "@/domains/smart-devices/components/LocksList";
import { listSmartDevices } from "@/domains/smart-devices/services/smart-devices.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function LocksPage() {
  const actor = await getCurrentUser();
  const devices = await listSmartDevices(actor);
  const locks = devices.filter((d) => d.deviceType === "LOCK");

  return (
    <div>
      <PageHeader
        title="Locks"
        subtitle="Every August lock across all properties — status, battery, and sync detail."
      />
      <LocksList locks={locks} />
    </div>
  );
}
