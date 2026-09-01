import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => {
  const tx = {
    $queryRaw: vi.fn(),
    integrationSyncLog: {
      findFirst: vi.fn(),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  return {
    prisma: {
      integrationConnection: {
        upsert: vi.fn().mockResolvedValue({}),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      integrationSyncLog: {
        create: vi.fn().mockResolvedValue({}),
        findFirst: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn((callback: (tx: unknown) => unknown) => callback(tx)),
      __tx: tx,
    },
  };
});

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
}));

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: vi.fn(),
}));

const mockListRecentlyEdited = vi.fn();
const mockQueryDataSource = vi.fn();
const mockListDataSourceRecords = vi.fn();
const mockSearch = vi.fn();
vi.mock("@stayw/integrations/notion", () => ({
  NotionClient: vi.fn().mockImplementation(() => ({
    listRecentlyEdited: mockListRecentlyEdited,
    queryDataSource: mockQueryDataSource,
    listDataSourceRecords: mockListDataSourceRecords,
    search: mockSearch,
  })),
}));

const mockListBookings = vi.fn();
const mockListProperties = vi.fn();
vi.mock("@stayw/integrations/ownerrez", () => ({
  OwnerrezClient: vi.fn().mockImplementation(() => ({
    listBookings: mockListBookings,
    listProperties: mockListProperties,
  })),
}));

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import { NOTION_SEARCH_EXCLUDED_DATABASE_IDS } from "../config/notion-search-exclusions";
import {
  beginDeviceSync,
  disconnectIntegration,
  finishDeviceSync,
  getNotionHighlights,
  getNotionIntegrationConfigStatus,
  getNotionListingsAccessProof,
  getOwnerRezHighlights,
  getOwnerRezProperties,
  listIntegrationConnections,
  listNotionListings,
  searchNotionContent,
} from "./integrations.service";

import { recordAudit } from "@/platform/audit/record-audit";

const actor = { userId: "user-1" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tx = (prisma as any).__tx;

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

describe("beginDeviceSync", () => {
  it("acquires the advisory lock, creates a RUNNING log row, and returns its id when nothing else is running", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.integrationConnection.findUnique).mockResolvedValueOnce({
      id: "ic-august",
      provider: "AUGUST",
    } as never);
    vi.mocked(tx.$queryRaw).mockResolvedValueOnce([{ locked: true }]);
    vi.mocked(tx.integrationSyncLog.findFirst).mockResolvedValueOnce(null);
    vi.mocked(tx.integrationSyncLog.create).mockResolvedValueOnce({
      id: "log-1",
    } as never);

    const result = await beginDeviceSync(actor, "ic-august", "AUGUST");

    expect(assertPermission).toHaveBeenCalledWith(actor, "integrations:update");
    expect(prisma.integrationConnection.findUnique).toHaveBeenCalledWith({
      where: { id: "ic-august" },
    });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.integrationSyncLog.findFirst).toHaveBeenCalledWith({
      where: { integrationConnectionId: "ic-august", status: "RUNNING" },
    });
    expect(tx.integrationSyncLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        integrationConnectionId: "ic-august",
        direction: "INBOUND",
        entityType: "SmartDevice",
        status: "RUNNING",
      }),
    });
    expect(result).toEqual({ logId: "log-1", alreadyRunning: false });
  });

  it("refuses immediately when the advisory lock is already held by a concurrent request", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.integrationConnection.findUnique).mockResolvedValueOnce({
      id: "ic-cielo",
      provider: "CIELO",
    } as never);
    vi.mocked(tx.$queryRaw).mockResolvedValueOnce([{ locked: false }]);

    const result = await beginDeviceSync(actor, "ic-cielo", "CIELO");

    expect(result).toEqual({ alreadyRunning: true });
    expect(tx.integrationSyncLog.findFirst).not.toHaveBeenCalled();
    expect(tx.integrationSyncLog.create).not.toHaveBeenCalled();
  });

  it("refuses to start a second sync when a fresh RUNNING row already exists", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.integrationConnection.findUnique).mockResolvedValueOnce({
      id: "ic-cielo",
      provider: "CIELO",
    } as never);
    vi.mocked(tx.$queryRaw).mockResolvedValueOnce([{ locked: true }]);
    vi.mocked(tx.integrationSyncLog.findFirst).mockResolvedValueOnce({
      id: "log-existing",
      startedAt: new Date(), // just started — well within the staleness window
    } as never);

    const result = await beginDeviceSync(actor, "ic-cielo", "CIELO");

    expect(result).toEqual({ alreadyRunning: true });
    expect(tx.integrationSyncLog.update).not.toHaveBeenCalled();
    expect(tx.integrationSyncLog.create).not.toHaveBeenCalled();
  });

  it("closes out a stale RUNNING row (older than 5 minutes) as FAILED, then proceeds with a new sync", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.integrationConnection.findUnique).mockResolvedValueOnce({
      id: "ic-august",
      provider: "AUGUST",
    } as never);
    vi.mocked(tx.$queryRaw).mockResolvedValueOnce([{ locked: true }]);
    vi.mocked(tx.integrationSyncLog.findFirst).mockResolvedValueOnce({
      id: "log-stale",
      startedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago — stale
    } as never);
    vi.mocked(tx.integrationSyncLog.create).mockResolvedValueOnce({
      id: "log-new",
    } as never);

    const result = await beginDeviceSync(actor, "ic-august", "AUGUST");

    expect(tx.integrationSyncLog.update).toHaveBeenCalledWith({
      where: { id: "log-stale" },
      data: expect.objectContaining({
        status: "FAILED",
        errorMessage: expect.stringContaining("terminated unexpectedly"),
      }),
    });
    expect(tx.integrationSyncLog.create).toHaveBeenCalled();
    expect(result).toEqual({ logId: "log-new", alreadyRunning: false });
  });

  it("refuses when the connection id's actual provider doesn't match the expected provider", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.integrationConnection.findUnique).mockResolvedValueOnce({
      id: "ic-cielo",
      provider: "CIELO",
    } as never);

    const result = await beginDeviceSync(actor, "ic-cielo", "AUGUST");

    expect(result).toEqual({ wrongConnection: true });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses when the connection id doesn't exist", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.integrationConnection.findUnique).mockResolvedValueOnce(
      null,
    );

    const result = await beginDeviceSync(actor, "missing-id", "AUGUST");

    expect(result).toEqual({ wrongConnection: true });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("denies starting a sync and performs no writes when the actor lacks integrations:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      beginDeviceSync(actor, "ic-august", "AUGUST"),
    ).rejects.toThrow();
    expect(prisma.integrationSyncLog.create).not.toHaveBeenCalled();
  });
});

describe("finishDeviceSync", () => {
  it("updates the same log row to SUCCEEDED and marks the connection CONNECTED with lastSyncedAt", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.integrationSyncLog.update).mockResolvedValueOnce({
      id: "log-1",
      integrationConnectionId: "ic-august",
    } as never);

    await finishDeviceSync(actor, "log-1", {
      status: "SUCCEEDED",
      recordsProcessed: 3,
    });

    expect(assertPermission).toHaveBeenCalledWith(actor, "integrations:update");
    expect(prisma.integrationSyncLog.update).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: expect.objectContaining({
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

  it("updates the same log row to FAILED with the error message and does not mark the connection connected", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.integrationSyncLog.update).mockResolvedValueOnce({
      id: "log-2",
      integrationConnectionId: "ic-cielo",
    } as never);

    await finishDeviceSync(actor, "log-2", {
      status: "FAILED",
      errorMessage: "Cielo login failed: bad credentials",
    });

    expect(prisma.integrationSyncLog.update).toHaveBeenCalledWith({
      where: { id: "log-2" },
      data: expect.objectContaining({
        status: "FAILED",
        recordsProcessed: 0,
        errorMessage: "Cielo login failed: bad credentials",
      }),
    });
    expect(prisma.integrationConnection.update).not.toHaveBeenCalled();
  });

  it("denies finishing a sync and performs no writes when the actor lacks integrations:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      finishDeviceSync(actor, "log-1", {
        status: "SUCCEEDED",
        recordsProcessed: 1,
      }),
    ).rejects.toThrow();
    expect(prisma.integrationSyncLog.update).not.toHaveBeenCalled();
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

describe("getNotionListingsAccessProof", () => {
  const originalToken = process.env.NOTION_API_KEY;
  const originalDataSourceId = process.env.NOTION_LISTINGS_DATA_SOURCE_ID;
  afterEach(() => {
    process.env.NOTION_API_KEY = originalToken;
    process.env.NOTION_LISTINGS_DATA_SOURCE_ID = originalDataSourceId;
  });

  it("reports not configured when NOTION_API_KEY is unset, without calling Notion", async () => {
    delete process.env.NOTION_API_KEY;
    process.env.NOTION_LISTINGS_DATA_SOURCE_ID = "ds-123";
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);

    const result = await getNotionListingsAccessProof(actor);

    expect(result).toEqual({ configured: false });
    expect(mockQueryDataSource).not.toHaveBeenCalled();
  });

  it("reports not configured when NOTION_LISTINGS_DATA_SOURCE_ID is unset, without calling Notion", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    delete process.env.NOTION_LISTINGS_DATA_SOURCE_ID;
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);

    const result = await getNotionListingsAccessProof(actor);

    expect(result).toEqual({ configured: false });
    expect(mockQueryDataSource).not.toHaveBeenCalled();
  });

  it("returns the real result count and first title on a successful one-row read", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    process.env.NOTION_LISTINGS_DATA_SOURCE_ID = "ds-123";
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockQueryDataSource.mockResolvedValueOnce({
      resultCount: 1,
      firstTitle: "Aqua Palm",
    });

    const result = await getNotionListingsAccessProof(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "integrations:read");
    expect(mockQueryDataSource).toHaveBeenCalledWith("ds-123", 1);
    expect(result).toEqual({
      configured: true,
      ok: true,
      resultCount: 1,
      firstTitle: "Aqua Palm",
    });
  });

  it("classifies a 401 as unauthorized", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    process.env.NOTION_LISTINGS_DATA_SOURCE_ID = "ds-123";
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockQueryDataSource.mockRejectedValueOnce(
      new Error("Request to /data_sources/ds-123/query failed with 401"),
    );

    const result = await getNotionListingsAccessProof(actor);

    expect(result).toEqual({
      configured: true,
      ok: false,
      reason: "unauthorized",
      error: "Request to /data_sources/ds-123/query failed with 401",
    });
  });

  it("classifies a 404 as not_found_or_no_access (not shared, or an invalid data source ID)", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    process.env.NOTION_LISTINGS_DATA_SOURCE_ID = "ds-123";
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockQueryDataSource.mockRejectedValueOnce(
      new Error("Request to /data_sources/ds-123/query failed with 404"),
    );

    const result = await getNotionListingsAccessProof(actor);

    expect(result).toEqual({
      configured: true,
      ok: false,
      reason: "not_found_or_no_access",
      error: "Request to /data_sources/ds-123/query failed with 404",
    });
  });

  it("classifies a 400 as version_or_validation_error", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    process.env.NOTION_LISTINGS_DATA_SOURCE_ID = "ds-123";
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockQueryDataSource.mockRejectedValueOnce(
      new Error("Request to /data_sources/ds-123/query failed with 400"),
    );

    const result = await getNotionListingsAccessProof(actor);

    expect(result).toEqual({
      configured: true,
      ok: false,
      reason: "version_or_validation_error",
      error: "Request to /data_sources/ds-123/query failed with 400",
    });
  });

  it("classifies anything else (e.g. a network failure) as unexpected_error", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    process.env.NOTION_LISTINGS_DATA_SOURCE_ID = "ds-123";
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockQueryDataSource.mockRejectedValueOnce(new Error("network error"));

    const result = await getNotionListingsAccessProof(actor);

    expect(result).toEqual({
      configured: true,
      ok: false,
      reason: "unexpected_error",
      error: "network error",
    });
  });

  it("propagates denial when the actor lacks integrations:read", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    process.env.NOTION_LISTINGS_DATA_SOURCE_ID = "ds-123";
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(getNotionListingsAccessProof(actor)).rejects.toThrow();
    expect(mockQueryDataSource).not.toHaveBeenCalled();
  });
});

describe("listNotionListings", () => {
  const originalToken = process.env.NOTION_API_KEY;
  const originalDataSourceId = process.env.NOTION_LISTINGS_DATA_SOURCE_ID;
  afterEach(() => {
    process.env.NOTION_API_KEY = originalToken;
    process.env.NOTION_LISTINGS_DATA_SOURCE_ID = originalDataSourceId;
  });

  it("reports not configured when NOTION_API_KEY is unset, without calling Notion", async () => {
    delete process.env.NOTION_API_KEY;
    process.env.NOTION_LISTINGS_DATA_SOURCE_ID = "ds-123";
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);

    const result = await listNotionListings(actor);

    expect(result).toEqual({ configured: false });
    expect(mockListDataSourceRecords).not.toHaveBeenCalled();
  });

  it("reports not configured when NOTION_LISTINGS_DATA_SOURCE_ID is unset, without calling Notion", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    delete process.env.NOTION_LISTINGS_DATA_SOURCE_ID;
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);

    const result = await listNotionListings(actor);

    expect(result).toEqual({ configured: false });
    expect(mockListDataSourceRecords).not.toHaveBeenCalled();
  });

  it("attaches a resolved region to every returned record", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    process.env.NOTION_LISTINGS_DATA_SOURCE_ID = "ds-123";
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockListDataSourceRecords.mockResolvedValueOnce([
      {
        id: "1",
        url: "https://notion.so/1",
        name: "Moonlit Cove",
        address: "123 Main St",
        bedrooms: 3,
        bathrooms: 2,
        guests: 6,
        directBooking: null,
        airbnbLink: null,
        vrboLink: null,
        googleDrivePhotosUrl: null,
        guidebookUrl: null,
      },
      {
        id: "2",
        url: "https://notion.so/2",
        name: "Some Unmapped Property",
        address: null,
        bedrooms: null,
        bathrooms: null,
        guests: null,
        directBooking: null,
        airbnbLink: null,
        vrboLink: null,
        googleDrivePhotosUrl: null,
        guidebookUrl: null,
      },
    ]);

    const result = await listNotionListings(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "integrations:read");
    expect(mockListDataSourceRecords).toHaveBeenCalledWith("ds-123");
    expect(result).toEqual({
      configured: true,
      ok: true,
      items: [
        expect.objectContaining({ name: "Moonlit Cove", region: "SRQ" }),
        expect.objectContaining({
          name: "Some Unmapped Property",
          region: "Unknown / Unassigned",
        }),
      ],
    });
  });

  it("returns zero listings without error when the data source is empty", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    process.env.NOTION_LISTINGS_DATA_SOURCE_ID = "ds-123";
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockListDataSourceRecords.mockResolvedValueOnce([]);

    const result = await listNotionListings(actor);

    expect(result).toEqual({ configured: true, ok: true, items: [] });
  });

  it("surfaces a live API failure as ok: false rather than swallowing it", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    process.env.NOTION_LISTINGS_DATA_SOURCE_ID = "ds-123";
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockListDataSourceRecords.mockRejectedValueOnce(new Error("network error"));

    const result = await listNotionListings(actor);

    expect(result).toEqual({
      configured: true,
      ok: false,
      error: "network error",
    });
  });

  it("propagates denial when the actor lacks integrations:read", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    process.env.NOTION_LISTINGS_DATA_SOURCE_ID = "ds-123";
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(listNotionListings(actor)).rejects.toThrow();
    expect(mockListDataSourceRecords).not.toHaveBeenCalled();
  });
});

describe("searchNotionContent", () => {
  const originalToken = process.env.NOTION_API_KEY;
  const originalDataSourceId = process.env.NOTION_LISTINGS_DATA_SOURCE_ID;
  afterEach(() => {
    process.env.NOTION_API_KEY = originalToken;
    process.env.NOTION_LISTINGS_DATA_SOURCE_ID = originalDataSourceId;
  });

  it("reports not configured when NOTION_API_KEY is unset, without calling Notion", async () => {
    delete process.env.NOTION_API_KEY;
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);

    const result = await searchNotionContent(actor, "pool");

    expect(result).toEqual({ configured: false });
    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockListDataSourceRecords).not.toHaveBeenCalled();
  });

  it("returns an empty result set for a blank query without calling Notion", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);

    const result = await searchNotionContent(actor, "   ");

    expect(result).toEqual({
      configured: true,
      ok: true,
      query: "",
      results: [],
    });
    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockListDataSourceRecords).not.toHaveBeenCalled();
  });

  it("does not call listDataSourceRecords when NOTION_LISTINGS_DATA_SOURCE_ID is unset, but still runs the general search", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    delete process.env.NOTION_LISTINGS_DATA_SOURCE_ID;
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockSearch.mockResolvedValueOnce([]);

    const result = await searchNotionContent(actor, "pool");

    expect(mockListDataSourceRecords).not.toHaveBeenCalled();
    expect(mockSearch).toHaveBeenCalledWith({ query: "pool", maxPages: 3 });
    expect(result).toEqual({
      configured: true,
      ok: true,
      query: "pool",
      results: [],
    });
  });

  it("returns a matching listing as a richer 'Property listing' card, with region and address as the snippet", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    process.env.NOTION_LISTINGS_DATA_SOURCE_ID = "ds-123";
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockListDataSourceRecords.mockResolvedValueOnce([
      {
        id: "listing-1",
        url: "https://notion.so/listing-1",
        name: "Moonlit Cove",
        address: "123 Main St",
        bedrooms: 3,
        bathrooms: 2,
        guests: 6,
        directBooking: null,
        airbnbLink: null,
        vrboLink: null,
        googleDrivePhotosUrl: null,
        guidebookUrl: null,
      },
    ]);
    mockSearch.mockResolvedValueOnce([]);

    const result = await searchNotionContent(actor, "moonlit");

    expect(result).toEqual({
      configured: true,
      ok: true,
      query: "moonlit",
      results: [
        {
          id: "listing-1",
          title: "Moonlit Cove",
          url: "https://notion.so/listing-1",
          lastEditedTime: null,
          contentType: "Property listing",
          region: "SRQ",
          snippet: "123 Main St",
        },
      ],
    });
  });

  it("labels a general search result by its sourceType and attaches a resolvable region when the title matches the known reference table", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    delete process.env.NOTION_LISTINGS_DATA_SOURCE_ID;
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockSearch.mockResolvedValueOnce([
      {
        id: "db-1",
        title: "View of Listings",
        url: "https://notion.so/db-1",
        lastEditedTime: "2026-08-24T00:00:00.000Z",
        sourceType: "database",
      },
      {
        id: "row-1",
        title: "Pool Cleaning Schedule",
        url: "https://notion.so/row-1",
        lastEditedTime: "2026-08-27T00:00:00.000Z",
        sourceType: "database_row",
      },
      {
        id: "page-1",
        title: "Moonlit Cove",
        url: "https://notion.so/page-1",
        lastEditedTime: "2026-08-04T00:00:00.000Z",
        sourceType: "page",
      },
    ]);

    const result = await searchNotionContent(actor, "moonlit");

    expect(result).toEqual({
      configured: true,
      ok: true,
      query: "moonlit",
      results: [
        expect.objectContaining({
          id: "db-1",
          contentType: "Notion database",
          region: null,
          snippet: null,
        }),
        expect.objectContaining({
          id: "row-1",
          contentType: "Database row",
          region: null,
        }),
        expect.objectContaining({
          id: "page-1",
          contentType: "Notion page",
          region: "SRQ",
        }),
      ],
    });
  });

  it("dedupes a general search result that is the same object as an already-matched listing", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    process.env.NOTION_LISTINGS_DATA_SOURCE_ID = "ds-123";
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockListDataSourceRecords.mockResolvedValueOnce([
      {
        id: "row-1",
        url: "https://notion.so/row-1",
        name: "Moonlit Cove",
        address: null,
        bedrooms: null,
        bathrooms: null,
        guests: null,
        directBooking: null,
        airbnbLink: null,
        vrboLink: null,
        googleDrivePhotosUrl: null,
        guidebookUrl: null,
      },
    ]);
    mockSearch.mockResolvedValueOnce([
      {
        id: "row-1",
        title: "Moonlit Cove",
        url: "https://notion.so/row-1",
        lastEditedTime: "2026-08-04T00:00:00.000Z",
        sourceType: "database_row",
      },
    ]);

    const result = await searchNotionContent(actor, "moonlit");

    expect(result.configured).toBe(true);
    if (result.configured && result.ok) {
      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toEqual(
        expect.objectContaining({
          id: "row-1",
          contentType: "Property listing",
        }),
      );
    }
  });

  it("surfaces a live API failure as ok: false rather than swallowing it", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    delete process.env.NOTION_LISTINGS_DATA_SOURCE_ID;
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockSearch.mockRejectedValueOnce(new Error("network error"));

    const result = await searchNotionContent(actor, "pool");

    expect(result).toEqual({
      configured: true,
      ok: false,
      query: "pool",
      error: "network error",
    });
  });

  it("propagates denial when the actor lacks integrations:read", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(searchNotionContent(actor, "pool")).rejects.toThrow();
    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockListDataSourceRecords).not.toHaveBeenCalled();
  });

  it("excludes a row belonging to a known staff/contact-directory database, by id, while keeping an unrelated operational row", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    delete process.env.NOTION_LISTINGS_DATA_SOURCE_ID;
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const [excludedDbId] = NOTION_SEARCH_EXCLUDED_DATABASE_IDS;
    mockSearch.mockResolvedValueOnce([
      {
        id: "staff-row-1",
        title: "Jenny - CEO and Founder",
        url: "https://notion.so/staff-row-1",
        lastEditedTime: "2026-07-15T00:00:00.000Z",
        sourceType: "database_row",
        parentDatabaseId: excludedDbId,
      },
      {
        id: "sop-row-1",
        title: "SOP for VRBO & Direct Bookings",
        url: "https://notion.so/sop-row-1",
        lastEditedTime: "2026-07-14T00:00:00.000Z",
        sourceType: "database_row",
        parentDatabaseId: "some-operational-database-id",
      },
    ]);

    const result = await searchNotionContent(actor, "vrbo");

    expect(result.configured).toBe(true);
    if (result.configured && result.ok) {
      expect(result.results.map((r) => r.id)).toEqual(["sop-row-1"]);
      expect(result.results[0]?.title).toBe("SOP for VRBO & Direct Bookings");
    }
  });

  it("excludes the excluded database object itself from results", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    delete process.env.NOTION_LISTINGS_DATA_SOURCE_ID;
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const [excludedDbId] = NOTION_SEARCH_EXCLUDED_DATABASE_IDS;
    mockSearch.mockResolvedValueOnce([
      {
        id: excludedDbId,
        title: "People",
        url: "https://notion.so/people-db",
        lastEditedTime: "2026-06-04T00:00:00.000Z",
        sourceType: "database",
        parentDatabaseId: null,
      },
    ]);

    const result = await searchNotionContent(actor, "people");

    expect(result.configured).toBe(true);
    if (result.configured && result.ok) {
      expect(result.results).toHaveLength(0);
    }
  });

  it("does not exclude operational content just because its title mentions a staff member's name", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    delete process.env.NOTION_LISTINGS_DATA_SOURCE_ID;
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockSearch.mockResolvedValueOnce([
      {
        id: "faq-1",
        title: "Michelle's Guide to Early Check-in Requests",
        url: "https://notion.so/faq-1",
        lastEditedTime: "2026-08-26T00:00:00.000Z",
        sourceType: "page",
        parentDatabaseId: null,
      },
    ]);

    const result = await searchNotionContent(actor, "check-in");

    expect(result.configured).toBe(true);
    if (result.configured && result.ok) {
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.title).toBe(
        "Michelle's Guide to Early Check-in Requests",
      );
    }
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

describe("getOwnerRezProperties", () => {
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

    const result = await getOwnerRezProperties(actor);

    expect(result).toEqual({ configured: false });
    expect(mockListProperties).not.toHaveBeenCalled();
  });

  it("returns real properties, uncapped, when configured and the call succeeds", async () => {
    process.env.OWNERREZ_USERNAME = "demo-user";
    process.env.OWNERREZ_API_TOKEN = "demo-token";
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const properties = [
      { id: 1, name: "Cabin A", key: "cabin-a", active: true },
      { id: 2, name: "Cabin B", key: "cabin-b", active: false },
    ];
    mockListProperties.mockResolvedValueOnce(properties);

    const result = await getOwnerRezProperties(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "integrations:read");
    expect(result).toEqual({ configured: true, ok: true, items: properties });
  });

  it("surfaces a real failure instead of swallowing it or inventing data", async () => {
    process.env.OWNERREZ_USERNAME = "demo-user";
    process.env.OWNERREZ_API_TOKEN = "demo-token";
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockListProperties.mockRejectedValueOnce(
      new Error("Request failed with 401"),
    );

    const result = await getOwnerRezProperties(actor);

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

    await expect(getOwnerRezProperties(actor)).rejects.toThrow();
    expect(mockListProperties).not.toHaveBeenCalled();
  });
});

describe("getNotionIntegrationConfigStatus", () => {
  const originalToken = process.env.NOTION_API_KEY;
  afterEach(() => {
    process.env.NOTION_API_KEY = originalToken;
  });

  it("reports configured: false when NOTION_API_KEY is unset", async () => {
    delete process.env.NOTION_API_KEY;
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);

    const result = await getNotionIntegrationConfigStatus(actor);

    expect(result).toEqual({ configured: false });
  });

  it("reports configured: true when NOTION_API_KEY is set, without making any network call", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);

    const result = await getNotionIntegrationConfigStatus(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "integrations:read");
    expect(result).toEqual({ configured: true });
    expect(mockQueryDataSource).not.toHaveBeenCalled();
    expect(mockListRecentlyEdited).not.toHaveBeenCalled();
  });

  it("propagates denial when the actor lacks integrations:read", async () => {
    process.env.NOTION_API_KEY = "secret_test";
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(getNotionIntegrationConfigStatus(actor)).rejects.toThrow();
  });
});
