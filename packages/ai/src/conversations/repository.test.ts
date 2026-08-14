import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => ({
  prisma: {
    aiConversation: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    aiMessage: { create: vi.fn(), findMany: vi.fn() },
  },
  Prisma: {},
}));

import { prisma } from "@stayw/database";

import {
  appendMessage,
  closeConversation,
  createConversation,
  getConversation,
  getConversationHistory,
  listConversations,
} from "./repository";

describe("createConversation", () => {
  it("creates an ACTIVE conversation", async () => {
    vi.mocked(prisma.aiConversation.create).mockResolvedValue({
      id: "c1",
    } as never);

    await createConversation({
      context: "GUEST_SUPPORT",
      model: "test-model-v1",
    });

    expect(prisma.aiConversation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        context: "GUEST_SUPPORT",
        model: "test-model-v1",
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

describe("listConversations / getConversation", () => {
  it("lists conversations newest-first with a one-message preview", async () => {
    vi.mocked(prisma.aiConversation.findMany).mockResolvedValue([] as never);

    await listConversations();

    expect(prisma.aiConversation.findMany).toHaveBeenCalledWith({
      orderBy: { updatedAt: "desc" },
      include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
  });

  it("fetches one conversation with its full message history", async () => {
    vi.mocked(prisma.aiConversation.findUnique).mockResolvedValue(
      null as never,
    );

    await getConversation("c1");

    expect(prisma.aiConversation.findUnique).toHaveBeenCalledWith({
      where: { id: "c1" },
      include: { messages: { orderBy: { createdAt: "asc" } } },
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
