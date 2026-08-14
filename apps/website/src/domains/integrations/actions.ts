"use server";

import { revalidatePath } from "next/cache";

import { disconnectIntegrationSchema } from "./schemas/integrations.schema";
import {
  disconnectIntegration,
  recordIntegrationSync,
} from "./services/integrations.service";

import { getCurrentUser } from "@/platform/auth/get-current-user";
import {
  syncAugustDevices,
  syncCieloDevices,
} from "@/domains/smart-devices/services/smart-devices.service";

export async function disconnectIntegrationAction(formData: FormData) {
  const actor = await getCurrentUser();

  const input = disconnectIntegrationSchema.parse({
    provider: formData.get("provider"),
  });

  await disconnectIntegration(actor, input);
  revalidatePath("/integrations");
}

/**
 * Shared body for the two provider-specific actions below — both need the
 * same "run the sync, log what happened either way, surface real failures"
 * shape, just with a different sync function and provider name.
 */
async function runDeviceSync(
  provider: "AUGUST" | "CIELO",
  sync: (
    actor: Awaited<ReturnType<typeof getCurrentUser>>,
  ) => Promise<{ synced: number }>,
) {
  const actor = await getCurrentUser();

  try {
    const result = await sync(actor);
    await recordIntegrationSync(actor, provider, {
      status: "SUCCEEDED",
      recordsProcessed: result.synced,
    });
  } catch (err) {
    await recordIntegrationSync(actor, provider, {
      status: "FAILED",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    revalidatePath("/integrations");
    revalidatePath("/");
  }
}

export async function syncAugustDevicesAction() {
  await runDeviceSync("AUGUST", syncAugustDevices);
}

export async function syncCieloDevicesAction() {
  await runDeviceSync("CIELO", syncCieloDevices);
}
