-- CreateEnum
CREATE TYPE "CleanerStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CleanerAssignmentRole" AS ENUM ('PRIMARY', 'TEAM_MEMBER');

-- AlterTable
ALTER TABLE "cleaning_schedules" ADD COLUMN     "cleaner_id" UUID;

-- CreateTable
CREATE TABLE "cleaners" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "CleanerStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cleaners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleaner_contacts" (
    "id" UUID NOT NULL,
    "cleaner_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "relationship" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cleaner_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_cleaner_assignments" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "cleaner_id" UUID NOT NULL,
    "role" "CleanerAssignmentRole" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "assigned_by_user_id" UUID NOT NULL,
    "ended_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_cleaner_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cleaners_status_idx" ON "cleaners"("status");

-- CreateIndex
CREATE UNIQUE INDEX "cleaner_contacts_cleaner_id_phone_key" ON "cleaner_contacts"("cleaner_id", "phone");

-- CreateIndex
CREATE INDEX "property_cleaner_assignments_property_id_ended_at_idx" ON "property_cleaner_assignments"("property_id", "ended_at");

-- CreateIndex
CREATE INDEX "property_cleaner_assignments_cleaner_id_ended_at_idx" ON "property_cleaner_assignments"("cleaner_id", "ended_at");

-- CreateIndex
CREATE INDEX "cleaning_schedules_cleaner_id_idx" ON "cleaning_schedules"("cleaner_id");

-- AddForeignKey
ALTER TABLE "cleaning_schedules" ADD CONSTRAINT "cleaning_schedules_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "cleaners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaner_contacts" ADD CONSTRAINT "cleaner_contacts_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "cleaners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_cleaner_assignments" ADD CONSTRAINT "property_cleaner_assignments_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_cleaner_assignments" ADD CONSTRAINT "property_cleaner_assignments_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "cleaners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_cleaner_assignments" ADD CONSTRAINT "property_cleaner_assignments_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_cleaner_assignments" ADD CONSTRAINT "property_cleaner_assignments_ended_by_user_id_fkey" FOREIGN KEY ("ended_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Cleaner assignment rules Prisma's schema language can't express
-- (partial unique indexes), so they live here by hand. See the
-- PropertyCleanerAssignment model's doc comment in schema.prisma.
-- A row is CURRENT while ended_at IS NULL.

-- At most ONE current PRIMARY cleaner per property.
CREATE UNIQUE INDEX "property_cleaner_assignments_one_current_primary"
  ON "property_cleaner_assignments" ("property_id")
  WHERE "ended_at" IS NULL AND "role" = 'PRIMARY';

-- A cleaner holds at most one current assignment (of any role) per property.
CREATE UNIQUE INDEX "property_cleaner_assignments_one_current_per_cleaner"
  ON "property_cleaner_assignments" ("property_id", "cleaner_id")
  WHERE "ended_at" IS NULL;

-- An assignment can't end before it started.
ALTER TABLE "property_cleaner_assignments"
  ADD CONSTRAINT "property_cleaner_assignments_ended_after_started"
  CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at");

-- Keep all three new tables consistent with the Supabase Security P0 baseline
-- (see 20260917140000_enable_rls_public_tables): RLS enabled, no policies,
-- access governed entirely by the app's own RBAC layer via the
-- postgres-owned Prisma connection (table owners bypass RLS). Does NOT
-- force RLS, does NOT create a policy, does NOT touch any grant.
ALTER TABLE public.cleaners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_cleaner_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleaner_contacts ENABLE ROW LEVEL SECURITY;
