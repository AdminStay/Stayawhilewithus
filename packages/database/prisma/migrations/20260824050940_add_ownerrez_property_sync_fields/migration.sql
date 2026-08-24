-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "owner_rez_active" BOOLEAN,
ADD COLUMN     "owner_rez_last_seen_at" TIMESTAMP(3);
