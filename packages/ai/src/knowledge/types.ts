export interface KnowledgeQuery {
  query: string;
  propertyId?: string;
  topK?: number;
}

export interface KnowledgeResult {
  content: string;
  sourceRef: string;
  score: number;
}

export interface KnowledgeRetriever {
  retrieve(query: KnowledgeQuery): Promise<KnowledgeResult[]>;
}
