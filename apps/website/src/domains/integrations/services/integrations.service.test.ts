import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => ({
  prisma: {
    integrationConnection: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    integrationSyncLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
}));

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: vi.fn(),
}));

const mockListRecentlyEdited = vi.fn();
vi.mock("@stayw/integrations/notion", () => ({
  NotionClient: vi.fn().mockImplementation(() => ({
    listRecentlyEdited: mockListRecentlyEdited,
  })),
}));

const mockListBookings = vi.fn();
vi.mock("@stayw/integrations/ownerrez", () => ({
  OwnerrezClient: vi.fn().mockImplementation(() => ({
    listBookings: mockListBookings,
  })),
}));

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import {
  disconnectIntegration,
  getNotionHighlights,
  getOwnerRezHighlights,
  listIntegrationConnections,
  recordIntegrationSync,
} from "./integrations.service";

import { recordAudit } from "@/platform/audit/record-audit";

const actor = { userId: "user-1" };

describe("listIntegrationConnections", () => {
  it("upserts a row for every provider in the catalog, then lists them, when granted", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.integrationConnection.findMany).mockResolvedValueOnce([
      { id: "ic1" },
    ] as never);

    const result = await listIntegrationConnections(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "integrations:read");
    // 12 providers in the IntegrationProvider enum.
    expect(prisma.integrationConnection.upsert).toHaveBeenCalledTimes(12);
    expect(prisma.integrationConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { provider: "OWNERREZ" },
        create: expect.objectContaining({
          provider: "OWNERREZ",
          displayName: "OwnerRez",
        }),
        update: {},
      }),
    );
    expect(prisma.integrationConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { syncLogs: expect.any(Object) },
      }),
    );
    expect(result).toEqual([{ id: "ic1" }]);
  });

  it("propagates denial and never upserts when the actor lacks integrations:read", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(listIntegrationConnections(actor)).rejects.toThrow();
    expect(prisma.integrationConnection.upsert).not.toHaveBeenCalled();
    expect(prisma.integrationConnection.findMany).not.toHaveBeenCalled();
  });
});

describe("disconnectIntegration", () => {
  it("sets status to DISCONNECTED and audits it", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const updated = { id: "ic1", provider: "SLACK", status: "DISCONNECTED" };
    vi.mocked(prisma.integrationConnection.update).mockResolvedValueOnce(
      updated as never,
    );

    const result = await disconnectIntegration(actor, { provider: "SLACK" });

    expect(assertPermission).toHaveBeenCalledWith(actor, "integrations:update");
    expect(prisma.integrationConnection.update).toHaveBeenCalledWith({
      where: { provider: "SLACK" },
      data: { status: "DISCONNECTED" },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "integration_connection.disconnected",
        entityType: "IntegrationConnection",
        entityId: "ic1",
      }),
    );
    expect(result).toEqual(updated);
  });

  it("denies disconnecting and performs no writes when the actor lacks integrations:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      disconnectIntegration(actor, { provider: "SLACK" }),
    ).rejects.toThrow();
    expect(prisma.integrationConnection.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("recordIntegrationSync", () => {
  it("logs a SUCCEEDED sync and marks the connection CONNECTED with lastSyncedAt", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.integrationConnection.upsert).mockResolvedValueOnce({
      id: "ic-august",
    } as never);

    await recordIntegrationSync(actor, "AUGUST", {
      status: "SUCCEEDED",
      recordsProcessed: 3,
    });

    expect(assertPermission).toHaveBeenCalledWith(actor, "integrations:update");
    expect(prisma.integrationSyncLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        integrationConnectionId: "ic-august",
        direction: "INBOUND",
        entityType: "SmartDevice",
        status: "SUCCEEDED",
        recordsProcessed: 3,
        errorMessage: null,
      }),
    });
    expect(prisma.integrationConnection.update).toHaveBeenCalledWith({
      where: { id: "ic-august" },
      data: expect.objectContaining({ status: "CONNECTED" }),
    });
  });

  it("logs a FAILED sync with the error message and does not mark the connection connected", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.integrationConnection.upsert).mockResolvedValueOnce({
      id: "ic-cielo",
    } as never);

    await recordIntegrationSync(actor, "CIELO", {
      status: "FAILED",
      errorMessage: "Cielo login failed: bad credentials",
    });

    expect(prisma.integrationSyncLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        integrationConnectionId: "ic-cielo",
        status: "FAILED",
        recordsProcessed: 0,
        errorMessage: "Cielo login failed: bad credentials",
      }),
    });
    expect(prisma.integrationConnection.update).not.toHaveBeenCalled();
  });

  it("denies recording and performs no writes when the actor lacks integrations:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      recordIntegrationSync(actor, "AUGUST", {
        status: "SUCCEEDED",
        recordsProcessed: 1,
      }),
    ).rejects.toThrow();
    expect(prisma.integrationSyncLog.create).not.toHaveBeenCalled();
  });
});

describe("getNotionHighlights", () => {
  const originalEnv = process.env.NOTION_API_KEY;
  afterEach(() => {
    process.env.NOTION_API_KEY = originalEnv;
  });

  it("reports not configured when NOTION_API_KEY is unset, without calling Notion", async () => {
    delete process.env.NOTION_API_KEY;
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);

    const result = await getNotionHighlights(actor);

    expect(result).toEqual({ configured: false });
    expect(mockListRecentlyEdited).not.toHaveBeenCalled();
  });

  it("returns real items when configured and the call succeeds", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockListRecentlyEdited.mockResolvedValueOnce([
      {
        id: "p1",
        object: "page",
        title: "Ops notes",
        url: null,
        lastEditedTime: null,
      },
    ]);

    const result = await getNotionHighlights(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "integrations:read");
    expect(result).toEqual({
      configured: true,
      ok: true,
      items: [
        {
          id: "p1",
          object: "page",
          title: "Ops notes",
          url: null,
          lastEditedTime: null,
        },
      ],
    });
  });

  it("surfaces a real failure instead of swallowing it or inventing data", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockListRecentlyEdited.mockRejectedValueOnce(new Error("401 Unauthorized"));

    const result = await getNotionHighlights(actor);

    expect(result).toEqual({
      configured: true,
      ok: false,
      error: "401 Unauthorized",
    });
  });

  it("propagates denial when the actor lacks integrations:read", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(getNotionHighlights(actor)).rejects.toThrow();
    expect(mockListRecentlyEdited).not.toHaveBeenCalled();
  });
});

describe("getOwnerRezHighlights", () => {
  const originalUsername = process.env.OWNERREZ_USERNAME;
  const originalToken = process.env.OWNERREZ_API_TOKEN;
  afterEach(() => {
    process.env.OWNERREZ_USERNAME = originalUsername;
    process.env.OWNERREZ_API_TOKEN = originalToken;
  });

  it("reports not configured when either credential is unset, without calling OwnerRez", async () => {
    delete process.env.OWNERREZ_USERNAME;
    delete process.env.OWNERREZ_API_TOKEN;
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);

    const result = await getOwnerRezHighlights(actor);

    expect(result).toEqual({ configured: false });
    expect(mockListBookings).not.toHaveBeenCalled();
  });

  it("returns up to 5 upcoming bookings, soonest arrival first, when configured and the call succeeds", async () => {
    process.env.OWNERREZ_USERNAME = "demo-user";
    process.env.OWNERREZ_API_TOKEN = "demo-token";
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const farFuture = { id: 1, arrival: "2099-01-10" };
    const nearFuture = { id: 2, arrival: "2099-01-01" };
    const past = { id: 3, arrival: "2000-01-01" };
    mockListBookings.mockResolvedValueOnce([farFuture, past, nearFuture]);

    const result = await getOwnerRezHighlights(actor);

    expect(result).toEqual({
      configured: true,
      ok: true,
      items: [nearFuture, farFuture],
    });
  });

  it("falls back to the most recent past bookings when nothing is upcoming, without inventing data", async () => {
    process.env.OWNERREZ_USERNAME = "demo-user";
    process.env.OWNERREZ_API_TOKEN = "demo-token";
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const older = { id: 1, arrival: "2000-01-01" };
    const recent = { id: 2, arrival: "2010-01-01" };
    mockListBookings.mockResolvedValueOnce([older, recent]);

    const result = await getOwnerRezHighlights(actor);

    expect(result).toEqual({
      configured: true,
      ok: true,
      items: [recent, older],
    });
  });

  it("caps at 5 items even with more upcoming bookings than that", async () => {
    process.env.OWNERREZ_USERNAME = "demo-user";
    process.env.OWNERREZ_API_TOKEN = "demo-token";
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const bookings = Array.from({ length: 8 }, (_, i) => ({
      id: i,
      arrival: `2099-01-${String(i + 1).padStart(2, "0")}`,
    }));
    mockListBookings.mockResolvedValueOnce(bookings);

    const result = await getOwnerRezHighlights(actor);

    expect(result.configured && result.ok && result.items).toHaveLength(5);
  });

  it("surfaces a real failure instead of swallowing it or inventing data", async () => {
    process.env.OWNERREZ_USERNAME = "demo-user";
    process.env.OWNERREZ_API_TOKEN = "demo-token";
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockListBookings.mockRejectedValueOnce(
      new Error("Request failed with 401"),
    );

    const result = await getOwnerRezHighlights(actor);

    expect(result).toEqual({
      configured: true,
      ok: false,
      error: "Request failed with 401",
    });
  });

  it("propagates denial when the actor lacks integrations:read", async () => {
    process.env.OWNERREZ_USERNAME = "demo-user";
    process.env.OWNERREZ_API_TOKEN = "demo-token";
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(getOwnerRezHighlights(actor)).rejects.toThrow();
    expect(mockListBookings).not.toHaveBeenCalled();
  });
});
