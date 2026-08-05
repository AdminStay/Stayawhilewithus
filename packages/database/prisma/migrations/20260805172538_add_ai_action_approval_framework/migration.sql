-- CreateEnum
CREATE TYPE "AiActionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'EXECUTION_FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AiActionRiskLevel" AS ENUM ('LOW', 'STANDARD', 'HIGH');

-- AlterEnum
ALTER TYPE "ActorType" ADD VALUE 'AI';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'AI_ACTION_PENDING';

-- CreateTable
CREATE TABLE "ai_actions" (
    "id" UUID NOT NULL,
    "conversation_id" UUID,
    "tool_name" TEXT NOT NULL,
    "proposed_input" JSONB NOT NULL,
    "reasoning" TEXT,
    "status" "AiActionStatus" NOT NULL DEFAULT 'PENDING',
    "risk_level" "AiActionRiskLevel" NOT NULL DEFAULT 'STANDARD',
    "related_entity_type" TEXT,
    "related_entity_id" TEXT,
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "executed_at" TIMESTAMP(3),
    "execution_result" JSONB,
    "execution_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_actions_status_idx" ON "ai_actions"("status");

-- CreateIndex
CREATE INDEX "ai_actions_conversation_id_idx" ON "ai_actions"("conversation_id");

-- AddForeignKey
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
