import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPreview, mockSync, mockRevalidatePath } = vi.hoisted(() => ({
  mockPreview: vi.fn(),
  mockSync: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));
vi.mock("@/platform/auth/get-current-user", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ userId: "admin-1" }),
}));
vi.mock("./services/ownerrez-reservation-sync.service", () => ({
  previewOwnerRezReservationSync: mockPreview,
  syncOwnerRezReservations: mockSync,
}));
vi.mock("./services/reservations.service", () => ({
  createReservation: vi.fn(),
  updateReservationStatus: vi.fn(),
}));

import { previewOwnerRezSyncAction } from "./actions";

describe("previewOwnerRezSyncAction (2026-09-28)", () => {
  beforeEach(() => {
    mockPreview.mockReset();
    mockSync.mockReset();
    mockRevalidatePath.mockReset();
  });

  it("calls only the read-only preview — never the real sync — and revalidates nothing", async () => {
    mockPreview.mockResolvedValue({
      configured: true,
      plan: {
        totalFetched: 1,
        toCreate: [
          {
            ownerRezBookingId: 1,
            ownerRezPropertyId: 500,
            propertyName: "Aqua Palm",
            status: "active",
            arrival: "2099-01-01",
            departure: "2099-01-04",
          },
        ],
        toUpdate: [],
        unmatchedProperty: [],
        unrecognizedStatus: [],
        nonGuest: [],
      },
    });

    const state = await previewOwnerRezSyncAction({ status: "idle" });

    expect(mockPreview).toHaveBeenCalledTimes(1);
    expect(mockSync).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
    expect(state).toMatchObject({
      status: "preview",
      summary: { bookingsEvaluated: 1, toCreate: 1, currentOrUpcoming: 1 },
    });
  });

  it("maps not-configured and provider errors without inventing data", async () => {
    mockPreview.mockResolvedValueOnce({ configured: false });
    expect(await previewOwnerRezSyncAction({ status: "idle" })).toEqual({
      status: "not_configured",
    });
    mockPreview.mockResolvedValueOnce({ configured: true, error: "429" });
    expect(await previewOwnerRezSyncAction({ status: "idle" })).toEqual({
      status: "failure",
      error: "429",
    });
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("a thrown error (e.g. permission denied) becomes a safe failure state", async () => {
    mockPreview.mockRejectedValueOnce(new Error("Forbidden"));
    const state = await previewOwnerRezSyncAction({ status: "idle" });
    expect(state).toEqual({
      status: "failure",
      error: "Something went wrong previewing the OwnerRez sync.",
    });
  });
});
