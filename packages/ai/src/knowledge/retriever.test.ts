import { describe, expect, it } from "vitest";

import { NotImplementedKnowledgeRetriever } from "./retriever";

describe("NotImplementedKnowledgeRetriever", () => {
  it("throws NotImplementedError instead of silently returning no results", async () => {
    const retriever = new NotImplementedKnowledgeRetriever();
    await expect(
      retriever.retrieve({ query: "wifi password" }),
    ).rejects.toThrow(/not implemented yet/);
  });
});
