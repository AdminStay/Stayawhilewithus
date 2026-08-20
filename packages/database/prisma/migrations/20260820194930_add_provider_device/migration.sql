-- CreateTable
CREATE TABLE "provider_devices" (
    "id" UUID NOT NULL,
    "integration_connection_id" UUID NOT NULL,
    "external_device_id" TEXT NOT NULL,
    "device_type" "SmartDeviceType" NOT NULL,
    "discovered_name" TEXT NOT NULL,
    "connectivity_status" "SmartDeviceStatus" NOT NULL DEFAULT 'UNKNOWN',
    "raw_metadata" JSONB NOT NULL DEFAULT '{}',
    "first_discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "property_id" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mapped_at" TIMESTAMP(3),
    "mapped_by_user_id" UUID,
    "smart_device_id" UUID,

    CONSTRAINT "provider_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "provider_devices_smart_device_id_key" ON "provider_devices"("smart_device_id");

-- CreateIndex
CREATE INDEX "provider_devices_property_id_idx" ON "provider_devices"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_devices_integration_connection_id_external_device__key" ON "provider_devices"("integration_connection_id", "external_device_id");

-- AddForeignKey
ALTER TABLE "provider_devices" ADD CONSTRAINT "provider_devices_integration_connection_id_fkey" FOREIGN KEY ("integration_connection_id") REFERENCES "integration_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_devices" ADD CONSTRAINT "provider_devices_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_devices" ADD CONSTRAINT "provider_devices_mapped_by_user_id_fkey" FOREIGN KEY ("mapped_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_devices" ADD CONSTRAINT "provider_devices_smart_device_id_fkey" FOREIGN KEY ("smart_device_id") REFERENCES "smart_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
