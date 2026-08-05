import { describe, expect, it } from "vitest";

import { OwnerrezClient } from "../ownerrez/client";
import { YaleClient } from "../yale/client";

import {
  hasCapability,
  isMessagingCapable,
  isSyncCapable,
  isWebhookReceivable,
} from "./capabilities";
import { NotImplementedError } from "./errors";

describe("capability type guards", () => {
  it("narrows a sync+webhook client (OwnerRez) correctly", () => {
    const client = new OwnerrezClient({ apiKey: "test" });

    expect(hasCapability(client, "sync")).toBe(true);
    expect(hasCapability(client, "webhook")).toBe(true);
    expect(hasCapability(client, "messaging")).toBe(false);
    expect(isSyncCapable(client)).toBe(true);
    expect(isWebhookReceivable(client)).toBe(true);
    expect(isMessagingCapable(client)).toBe(false);
  });

  it("narrows a webhook-only-plus-sync client (Yale) correctly", () => {
    const client = new YaleClient({ apiKey: "test" });

    expect(isSyncCapable(client)).toBe(true);
    expect(isWebhookReceivable(client)).toBe(true);
    expect(isMessagingCapable(client)).toBe(false);
  });

  it("every declared capability method still throws NotImplementedError", async () => {
    const client = new OwnerrezClient({ apiKey: "test" });

    await expect(client.connect()).rejects.toThrow(NotImplementedError);
    await expect(client.healthCheck()).rejects.toThrow(NotImplementedError);
    await expect(client.validateCredentials()).rejects.toThrow(
      NotImplementedError,
    );
    if (isSyncCapable(client)) {
      await expect(client.sync("INBOUND")).rejects.toThrow(NotImplementedError);
    }
    if (isWebhookReceivable(client)) {
      await expect(client.receiveWebhook("{}", {})).rejects.toThrow(
        NotImplementedError,
      );
    }
  });
});
