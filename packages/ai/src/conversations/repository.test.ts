import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => ({
  prisma: {
    aiConversation: { create: vi.fn(), update: vi.fn() },
    aiMessage: { create: vi.fn(), findMany: vi.fn() },
  },
  Prisma: {},
}));

import { prisma } from "@stayw/database";

import {
  appendMessage,
  closeConversation,
  createConversation,
  getConversationHistory,
} from "./repository";

describe("createConversation", () => {
  it("creates an ACTIVE conversation", async () => {
    vi.mocked(prisma.aiConversation.create).mockResolvedValue({
      id: "c1",
    } as never);

    await createConversation({
      context: "GUEST_SUPPORT",
      model: "claude-fable-5",
    });

    expect(prisma.aiConversation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        context: "GUEST_SUPPORT",
        model: "claude-fable-5",
        status: "ACTIVE",
      }),
    });
  });
});

describe("appendMessage / getConversationHistory", () => {
  it("appends a message tied to the conversation", async () => {
    vi.mocked(prisma.aiMessage.create).mockResolvedValue({ id: "m1" } as never);

    await appendMessage({
      conversationId: "c1",
      role: "USER",
      content: "Where's the wifi password?",
    });

    expect(prisma.aiMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: "c1",
        role: "USER",
        content: "Where's the wifi password?",
      }),
    });
  });

  it("reads history ordered oldest-first", async () => {
    vi.mocked(prisma.aiMessage.findMany).mockResolvedValue([] as never);

    await getConversationHistory("c1");

    expect(prisma.aiMessage.findMany).toHaveBeenCalledWith({
      where: { conversationId: "c1" },
      orderBy: { createdAt: "asc" },
    });
  });
});

describe("closeConversation", () => {
  it("defaults to RESOLVED", async () => {
    vi.mocked(prisma.aiConversation.update).mockResolvedValue({} as never);

    await closeConversation("c1");

    expect(prisma.aiConversation.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { status: "RESOLVED" },
    });
  });

  it("accepts ESCALATED explicitly", async () => {
    vi.mocked(prisma.aiConversation.update).mockResolvedValue({} as never);

    await closeConversation("c1", "ESCALATED");

    expect(prisma.aiConversation.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { status: "ESCALATED" },
    });
  });
});
