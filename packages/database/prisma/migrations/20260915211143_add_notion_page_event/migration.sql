-- CreateTable
CREATE TABLE "notion_page_events" (
    "id" UUID NOT NULL,
    "notion_event_id" TEXT,
    "entity_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "changed_field_names" JSONB NOT NULL DEFAULT '[]',
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notion_page_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notion_page_events_notion_event_id_key" ON "notion_page_events"("notion_event_id");

-- CreateIndex
CREATE INDEX "notion_page_events_entity_id_occurred_at_idx" ON "notion_page_events"("entity_id", "occurred_at");

-- CreateIndex
CREATE INDEX "notion_page_events_occurred_at_idx" ON "notion_page_events"("occurred_at");
