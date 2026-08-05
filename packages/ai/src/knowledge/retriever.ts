import { NotImplementedError } from "../errors";

import type {
  KnowledgeQuery,
  KnowledgeResult,
  KnowledgeRetriever,
} from "./types";

/**
 * Deliberate stub: real vector-store-backed retrieval (property manuals,
 * house rules, past-conversation recall) is deferred — see ADR-0007. The
 * interface exists now so the Context Engine and Orchestrator can depend on
 * it without a redesign once a real implementation lands.
 */
export class NotImplementedKnowledgeRetriever implements KnowledgeRetriever {
  async retrieve(_query: KnowledgeQuery): Promise<KnowledgeResult[]> {
    throw new NotImplementedError("KnowledgeRetriever", "retrieve");
  }
}
