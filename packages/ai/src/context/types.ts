export interface ContextRequest {
  userId?: string;
  guestId?: string;
  propertyId?: string;
  conversationId?: string;
}

export interface ContextFragment {
  source: string;
  content: string;
}

/** A pluggable source of background context (property details, guest history, open tasks, ...). */
export interface ContextProvider {
  name: string;
  provide(req: ContextRequest): Promise<ContextFragment[]>;
}
