import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => {
  const tx = {
    messageThread: { create: vi.fn(), update: vi.fn() },
    message: { create: vi.fn() },
  };
  return {
    prisma: {
      messageThread: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
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

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import {
  archiveMessageThread,
  closeMessageThread,
  createMessageThread,
  listMessageThreads,
  sendMessage,
} from "./communications.service";

import { recordAudit } from "@/platform/audit/record-audit";

const actor = { userId: "user-1" };

const threadInput = {
  propertyId: "prop-1",
  reservationId: "",
  guestId: "guest-1",
  subject: "Leaky faucet",
  body: "Guest reported a leaky faucet.",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tx = (prisma as any).__tx;

describe("listMessageThreads", () => {
  it("returns threads with property/guest/message relations when granted", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.messageThread.findMany).mockResolvedValueOnce([
      { id: "t1" },
    ] as never);

    const result = await listMessageThreads(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "messages:read");
    expect(prisma.messageThread.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ property: true, guest: true }),
      }),
    );
    expect(result).toEqual([{ id: "t1" }]);
  });

  it("propagates denial when the actor lacks messages:read", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(listMessageThreads(actor)).rejects.toThrow();
    expect(prisma.messageThread.findMany).not.toHaveBeenCalled();
  });
});

describe("createMessageThread", () => {
  it("creates the thread and its first message in one transaction, and audits it", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const thread = { id: "t1", ...threadInput };
    vi.mocked(tx.messageThread.create).mockResolvedValueOnce(thread as never);
    vi.mocked(tx.message.create).mockResolvedValueOnce({ id: "m1" } as never);

    const result = await createMessageThread(actor, threadInput);

    expect(assertPermission).toHaveBeenCalledWith(actor, "messages:create");
    expect(tx.messageThread.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel: "IN_APP",
        propertyId: "prop-1",
        reservationId: undefined,
        guestId: "guest-1",
      }),
    });
    expect(tx.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        threadId: "t1",
        direction: "OUTBOUND",
        senderUserId: actor.userId,
        body: threadInput.body,
      }),
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "message_thread.created",
        entityType: "MessageThread",
        entityId: "t1",
      }),
    );
    expect(result).toEqual(thread);
  });

  it("denies creation and performs no writes when the actor lacks messages:create", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(createMessageThread(actor, threadInput)).rejects.toThrow();
    expect(tx.messageThread.create).not.toHaveBeenCalled();
    expect(tx.message.create).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("sendMessage", () => {
  it("appends an outbound message to the thread and audits it", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const message = { id: "m2", threadId: "t1", body: "Sending someone over." };
    vi.mocked(tx.message.create).mockResolvedValueOnce(message as never);
    vi.mocked(tx.messageThread.update).mockResolvedValueOnce({} as never);

    const result = await sendMessage(actor, "t1", {
      body: "Sending someone over.",
    });

    expect(assertPermission).toHaveBeenCalledWith(actor, "messages:create");
    expect(tx.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        threadId: "t1",
        direction: "OUTBOUND",
        senderUserId: actor.userId,
        body: "Sending someone over.",
      }),
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "message.sent",
        entityType: "Message",
        entityId: "m2",
      }),
    );
    expect(result).toEqual(message);
  });

  it("denies sending and performs no writes when the actor lacks messages:create", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(sendMessage(actor, "t1", { body: "hi" })).rejects.toThrow();
    expect(tx.message.create).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("closeMessageThread", () => {
  it("marks the thread CLOSED and audits it", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const updated = { id: "t1", status: "CLOSED" };
    vi.mocked(prisma.messageThread.update).mockResolvedValueOnce(
      updated as never,
    );

    const result = await closeMessageThread(actor, "t1");

    expect(assertPermission).toHaveBeenCalledWith(actor, "messages:update");
    expect(prisma.messageThread.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "CLOSED" },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "message_thread.closed",
        entityType: "MessageThread",
        entityId: "t1",
      }),
    );
    expect(result).toEqual(updated);
  });

  it("denies closing and performs no writes when the actor lacks messages:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(closeMessageThread(actor, "t1")).rejects.toThrow();
    expect(prisma.messageThread.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("archiveMessageThread", () => {
  it("archives a closed thread and audits it", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.messageThread.findUnique).mockResolvedValueOnce({
      id: "t1",
      status: "CLOSED",
    } as never);
    const updated = { id: "t1", status: "ARCHIVED" };
    vi.mocked(prisma.messageThread.update).mockResolvedValueOnce(
      updated as never,
    );

    const result = await archiveMessageThread(actor, "t1");

    expect(assertPermission).toHaveBeenCalledWith(actor, "messages:update");
    expect(prisma.messageThread.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "ARCHIVED" },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "message_thread.archived",
        entityType: "MessageThread",
        entityId: "t1",
      }),
    );
    expect(result).toEqual(updated);
  });

  it("throws ConflictError and performs no update when the thread isn't CLOSED", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.messageThread.findUnique).mockResolvedValueOnce({
      id: "t1",
      status: "OPEN",
    } as never);

    await expect(archiveMessageThread(actor, "t1")).rejects.toThrow(
      /only closed threads/i,
    );
    expect(prisma.messageThread.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the thread doesn't exist", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.messageThread.findUnique).mockResolvedValueOnce(
      null as never,
    );

    await expect(archiveMessageThread(actor, "missing")).rejects.toThrow(
      /not found/i,
    );
    expect(prisma.messageThread.update).not.toHaveBeenCalled();
  });

  it("denies archiving and performs no writes when the actor lacks messages:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(archiveMessageThread(actor, "t1")).rejects.toThrow();
    expect(prisma.messageThread.findUnique).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
