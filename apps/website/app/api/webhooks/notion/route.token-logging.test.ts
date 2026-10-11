import { describe, expect, it, vi } from "vitest";

// The route must never write the verification token (the signing secret)
// to any log, whatever happens to the capture step.
const { capture } = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/domains/integrations/services/notion-webhook-setup.service", () => ({
  captureNotionWebhookVerificationToken: capture,
}));
vi.mock("@/domains/integrations/services/notion-webhook-event.service", () => ({
  processNotionWebhookEvent: vi.fn(),
}));

import { POST } from "./route";

import { processNotionWebhookEvent } from "@/domains/integrations/services/notion-webhook-event.service";

const TOKEN = "secret_FAKE_route_test_token_abcdef";
const handshake = () =>
  new Request("https://example.test/api/webhooks/notion", {
    method: "POST",
    body: JSON.stringify({ verification_token: TOKEN }),
  });

describe("/api/webhooks/notion handshake (2026-09-30)", () => {
  it("hands the token to the sealed capture and never logs or echoes it", async () => {
    const spies = ["log", "warn", "error", "info"].map((m) =>
      vi.spyOn(console, m as "log").mockImplementation(() => {}),
    );
    capture.mockResolvedValueOnce("captured");
    const res = await POST(handshake());
    expect(capture).toHaveBeenCalledWith(TOKEN);
    expect(await res.text()).not.toContain(TOKEN);
    expect(JSON.stringify(spies.map((s) => s.mock.calls))).not.toContain(TOKEN);
    spies.forEach((s) => s.mockRestore());
  });

  it("still never logs the token when capture fails", async () => {
    const spies = ["log", "warn", "error", "info"].map((m) =>
      vi.spyOn(console, m as "log").mockImplementation(() => {}),
    );
    capture.mockRejectedValueOnce(new Error(`db down while storing ${TOKEN}`));
    const res = await POST(handshake());
    expect(res.status).toBe(200);
    expect(JSON.stringify(spies.map((s) => s.mock.calls))).not.toContain(TOKEN);
    spies.forEach((s) => s.mockRestore());
  });
});

describe("/api/webhooks/notion event outcomes (2026-10-11)", () => {
  const signedEvent = () =>
    new Request("https://example.test/api/webhooks/notion", {
      method: "POST",
      headers: { "x-notion-signature": "sha256=abc" },
      body: JSON.stringify({ id: "evt-1", type: "page.created" }),
    });

  it("retry_later (exclusion check unavailable, nothing stored) → 503 so Notion redelivers", async () => {
    vi.mocked(processNotionWebhookEvent).mockResolvedValueOnce({
      status: "retry_later",
    });
    const res = await POST(signedEvent());
    expect(res.status).toBe(503);
  });

  it("excluded (staff/contact directory) → 200, acknowledged and not retried", async () => {
    vi.mocked(processNotionWebhookEvent).mockResolvedValueOnce({
      status: "excluded",
    });
    const res = await POST(signedEvent());
    expect(res.status).toBe(200);
  });
});
