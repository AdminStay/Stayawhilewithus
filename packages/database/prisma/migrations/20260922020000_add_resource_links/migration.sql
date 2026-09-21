-- CreateEnum
CREATE TYPE "ResourceLinkCategory" AS ENUM ('SOP', 'VENDOR', 'OPERATIONS', 'EMERGENCY', 'PROPERTY', 'OTHER');

-- CreateTable
CREATE TABLE "resource_links" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "category" "ResourceLinkCategory" NOT NULL DEFAULT 'OTHER',
    "property_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resource_links_property_id_idx" ON "resource_links"("property_id");

-- CreateIndex
CREATE INDEX "resource_links_category_idx" ON "resource_links"("category");

-- AddForeignKey
ALTER TABLE "resource_links" ADD CONSTRAINT "resource_links_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_links" ADD CONSTRAINT "resource_links_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep this new table consistent with the Supabase Security P0 baseline
-- (Increment 103/107 — see 20260917140000_enable_rls_public_tables): every
-- `public` table has RLS enabled, no policies, access governed entirely by
-- the app's own RBAC layer via the `postgres`-owned Prisma connection
-- (table owners bypass RLS regardless). Does NOT force RLS, does NOT
-- create a policy, does NOT touch any grant.
ALTER TABLE public.resource_links ENABLE ROW LEVEL SECURITY;

