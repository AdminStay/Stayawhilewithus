import { PrismaClient, PermissionAction, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// Single source of truth for the permission catalog is mirrored in
// packages/auth/src/permissions.ts — keep the two in sync when adding a
// new resource/action.
const RESOURCES = [
  "properties",
  "reservations",
  "guests",
  "tasks",
  "cleaning_schedules",
  "maintenance_requests",
  "messages",
  "notifications",
  "smart_devices",
  // See packages/auth/src/permissions.ts for why this is a separate
  // resource from "smart_devices" (read/mapping) rather than folded in.
  "thermostats",
  "integrations",
  "ai_conversations",
  "ai_actions",
  "audit_logs",
  "users",
  "roles",
] as const;

const ACTIONS: PermissionAction[] = [
  "CREATE",
  "READ",
  "UPDATE",
  "DELETE",
  "MANAGE",
];

const SYSTEM_ROLES: Array<{
  name: string;
  description: string;
  permissionKeys: string[] | "*";
}> = [
  { name: "admin", description: "Full system access", permissionKeys: "*" },
  {
    name: "ops_manager",
    description:
      "Manages properties, reservations, tasks, and staff assignments",
    permissionKeys: [
      "properties:read",
      "properties:update",
      "reservations:read",
      "reservations:update",
      "guests:read",
      "tasks:manage",
      "cleaning_schedules:manage",
      "maintenance_requests:manage",
      "messages:manage",
      "notifications:read",
      "ai_actions:read",
      "ai_actions:update",
      "smart_devices:read",
      "smart_devices:update",
      "integrations:read",
      "integrations:update",
    ],
  },
  {
    name: "cleaner",
    description: "Property-scoped: views and completes assigned cleaning tasks",
    permissionKeys: [
      "tasks:read",
      "tasks:update",
      "cleaning_schedules:read",
      "cleaning_schedules:update",
    ],
  },
  {
    name: "maintenance_tech",
    description:
      "Property-scoped: views and resolves assigned maintenance requests",
    permissionKeys: [
      "tasks:read",
      "tasks:update",
      "maintenance_requests:read",
      "maintenance_requests:update",
    ],
  },
  {
    name: "front_desk",
    description: "Property-scoped: guest communication and reservation lookups",
    permissionKeys: [
      "reservations:read",
      "guests:read",
      "guests:update",
      "messages:manage",
    ],
  },
  {
    name: "read_only",
    description: "Read-only access across ops data",
    permissionKeys: RESOURCES.map((r) => `${r}:read`),
  },
];

async function main() {
  console.log("Seeding permission catalog...");
  const permissionRecords = await Promise.all(
    RESOURCES.flatMap((resource) =>
      ACTIONS.map((action) =>
        prisma.permission.upsert({
          where: { key: `${resource}:${action.toLowerCase()}` },
          update: {},
          create: {
            key: `${resource}:${action.toLowerCase()}`,
            resource,
            action,
            description: `${action} on ${resource}`,
          },
        }),
      ),
    ),
  );
  console.log(`  ${permissionRecords.length} permissions ensured.`);

  console.log("Seeding system roles...");
  for (const roleDef of SYSTEM_ROLES) {
    const role = await prisma.role.upsert({
      where: { name: roleDef.name },
      update: { description: roleDef.description },
      create: {
        name: roleDef.name,
        description: roleDef.description,
        isSystem: true,
      },
    });

    const grantedPermissions =
      roleDef.permissionKeys === "*"
        ? permissionRecords
        : permissionRecords.filter((p) =>
            (roleDef.permissionKeys as string[]).includes(p.key),
          );

    await Promise.all(
      grantedPermissions.map((permission) =>
        prisma.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: role.id,
              permissionId: permission.id,
            },
          },
          update: {},
          create: { roleId: role.id, permissionId: permission.id },
        }),
      ),
    );
    console.log(
      `  Role "${role.name}": ${grantedPermissions.length} permissions granted.`,
    );
  }

  console.log("Seeding bootstrap admin user...");
  const adminEmail = "admin@stayawhilewithus.com";
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      // Placeholder Clerk ID — replace via the Clerk webhook sync once real
      // Clerk credentials are wired up; this lets the seed run standalone.
      clerkUserId: "seed_pending_clerk_link",
      email: adminEmail,
      firstName: "StayWhile",
      lastName: "Admin",
      status: "ACTIVE",
    },
  });

  const adminRole = await prisma.role.findUniqueOrThrow({
    where: { name: "admin" },
  });
  const existingGlobalAdminAssignment = await prisma.userRole.findFirst({
    where: { userId: admin.id, roleId: adminRole.id, propertyId: null },
  });
  if (!existingGlobalAdminAssignment) {
    await prisma.userRole.create({
      data: { userId: admin.id, roleId: adminRole.id, propertyId: null },
    });
  }
  console.log(`  Admin user "${adminEmail}" seeded with global "admin" role.`);

  await seedDemoData(admin.id);
}

/**
 * Clearly-fictional sample data so a client walkthrough isn't every list
 * page staring at empty tables — properties, guests, reservations, tasks,
 * cleaning schedules, a maintenance request, notifications, a message
 * thread, and an AI conversation. Idempotent on stable business keys
 * (internalCode/email/externalReservationId/etc.), same as the rest of
 * this script, so re-running `pnpm db:seed` is always safe — and dates are
 * recomputed relative to *today* on every run (not just on first creation)
 * so the demo still shows an arrival today / departure today / task due
 * today no matter which day someone actually runs the seed. Nothing here
 * is real StayWhile data — every name/address is a placeholder.
 */
async function seedDemoData(adminUserId: string): Promise<void> {
  console.log("Seeding demo business data...");

  const ridge = await prisma.property.upsert({
    where: { internalCode: "DEMO-001" },
    update: {},
    create: {
      name: "Cabin on the Ridge",
      internalCode: "DEMO-001",
      addressLine1: "142 Ridge Trail",
      city: "Estes Park",
      state: "CO",
      postalCode: "80517",
      country: "US",
      propertyType: "CABIN",
      bedroomCount: 3,
      bathroomCount: 2,
      maxOccupancy: 6,
      timezone: "America/Denver",
    },
  });

  const loft = await prisma.property.upsert({
    where: { internalCode: "DEMO-002" },
    update: {},
    create: {
      name: "Downtown Loft",
      internalCode: "DEMO-002",
      addressLine1: "88 Main St, Unit 4B",
      city: "Denver",
      state: "CO",
      postalCode: "80202",
      country: "US",
      propertyType: "APARTMENT",
      bedroomCount: 1,
      bathroomCount: 1,
      maxOccupancy: 2,
      timezone: "America/Denver",
    },
  });

  await seedDemoSmartDevices(ridge.id, loft.id);

  const jordan = await upsertDemoGuest({
    email: "jordan.rivera@example.com",
    firstName: "Jordan",
    lastName: "Rivera",
    phone: "+1-303-555-0142",
  });

  const casey = await upsertDemoGuest({
    email: "casey.nguyen@example.com",
    firstName: "Casey",
    lastName: "Nguyen",
    phone: "+1-303-555-0198",
  });

  // Built from UTC Y/M/D rather than `new Date(); .setHours(0,0,0,0)` —
  // Prisma serializes `@db.Date` columns via the Date object's UTC
  // representation, so local midnight on a machine ahead of UTC (e.g.
  // UTC+8) would otherwise get stored as *yesterday*. This keeps "today"
  // meaning the same calendar day both here and in the dashboard's own
  // "arrivals/departures/due today" comparisons (dashboard.service.ts),
  // which use the same construction.
  const now = new Date();
  const today = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );
  const daysFromNow = (n: number) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + n);
    return d;
  };

  // Ridge: arriving today, staying 4 nights — shows up under "arrivals
  // today" and counts toward today's occupancy.
  await upsertDemoReservation({
    externalReservationId: "DEMO-RES-001",
    propertyId: ridge.id,
    guestId: jordan.id,
    status: "CONFIRMED",
    checkInDate: daysFromNow(0),
    checkOutDate: daysFromNow(4),
    totalAmount: 640,
  });

  // Loft: already checked in, departing today — shows up under
  // "departures today" and also counts toward today's occupancy.
  await upsertDemoReservation({
    externalReservationId: "DEMO-RES-002",
    propertyId: loft.id,
    guestId: casey.id,
    status: "CHECKED_IN",
    checkInDate: daysFromNow(-3),
    checkOutDate: daysFromNow(0),
    totalAmount: 390,
  });

  // The Loft's next stay, a few days out — keeps the property list from
  // looking like Ridge is the only property with any real activity.
  await upsertDemoReservation({
    externalReservationId: "DEMO-RES-003",
    propertyId: loft.id,
    guestId: casey.id,
    status: "PENDING",
    checkInDate: daysFromNow(9),
    checkOutDate: daysFromNow(12),
    totalAmount: 450,
  });

  // Ridge: arrives and departs within the dashboard's "Coming Up" window
  // (the next few days beyond today, not today itself) — without this,
  // DEMO-RES-003's check-in falls outside that window and "upcoming
  // check-ins" would always demo empty. Starts the day after DEMO-RES-001
  // checks out (day 4) so the two don't double-book the property.
  await upsertDemoReservation({
    externalReservationId: "DEMO-RES-004",
    propertyId: ridge.id,
    guestId: jordan.id,
    status: "CONFIRMED",
    checkInDate: daysFromNow(5),
    checkOutDate: daysFromNow(6),
    totalAmount: 480,
  });

  // Loft's turnover clean, same-day as today's departure.
  await upsertDemoCleaningSchedule({
    slug: "DEMO-CLEAN-TODAY",
    property: loft,
    scheduledDate: daysFromNow(0),
    cleaningType: "TURNOVER",
    createdByUserId: adminUserId,
  });

  // Ridge's turnover clean ahead of its next guest.
  await upsertDemoCleaningSchedule({
    slug: "DEMO-CLEAN-UPCOMING",
    property: ridge,
    scheduledDate: daysFromNow(4),
    cleaningType: "TURNOVER",
    createdByUserId: adminUserId,
  });

  // A clean that was moved after originally being booked — so the
  // dashboard's "Rescheduled Cleanings" section has a real (if seeded) row
  // to demo instead of only existing in tests. Distinct slug/date from the
  // two above so it doesn't collide with them.
  await upsertDemoCleaningSchedule({
    slug: "DEMO-CLEAN-RESCHEDULED",
    property: ridge,
    scheduledDate: daysFromNow(6),
    originalScheduledDate: daysFromNow(3),
    cleaningType: "TURNOVER",
    createdByUserId: adminUserId,
  });

  const existingMaintenanceRequest = await prisma.maintenanceRequest.findFirst({
    where: {
      propertyId: ridge.id,
      description: "Kitchen faucet drips steadily",
    },
  });
  if (!existingMaintenanceRequest) {
    await prisma.maintenanceRequest.create({
      data: {
        propertyId: ridge.id,
        reportedByUserId: adminUserId,
        category: "PLUMBING",
        severity: "LOW",
        status: "OPEN",
        description: "Kitchen faucet drips steadily",
      },
    });
  }

  // A standalone task (not tied to cleaning/maintenance) due today, so
  // "tasks due today" has something real to show.
  const dueTodayTitle = "Restock welcome basket — Cabin on the Ridge";
  const existingDueTodayTask = await prisma.task.findFirst({
    where: { title: dueTodayTitle },
  });
  if (existingDueTodayTask) {
    await prisma.task.update({
      where: { id: existingDueTodayTask.id },
      data: { dueAt: daysFromNow(0), status: "TODO" },
    });
  } else {
    await prisma.task.create({
      data: {
        title: dueTodayTitle,
        type: "GENERAL",
        priority: "NORMAL",
        propertyId: ridge.id,
        assignedToUserId: adminUserId,
        createdByUserId: adminUserId,
        dueAt: daysFromNow(0),
      },
    });
  }

  await seedDemoNotifications(adminUserId);
  await seedDemoCommunications({ property: ridge, guest: jordan });
  await seedDemoAiConversation();
  await seedDemoAuditTrail(adminUserId);

  console.log(
    "  2 properties, 2 guests, 4 reservations, 3 cleaning schedules (1 rescheduled), 6 smart devices, 1 maintenance request, 1 task due today, notifications, a message thread, an AI conversation, and an audit trail ensured.",
  );
}

/**
 * `recordAudit()` (apps/website/src/platform/audit/record-audit.ts) is the
 * only path real domain services use to write AuditLog rows — this seed
 * script deliberately doesn't call into apps/website's service layer (that
 * would be a backwards package dependency, packages/database -> apps/
 * website), so demo data created directly via Prisma above never produced
 * any audit trail. Without this, the /audit page would be the one screen
 * left empty even though everything else has demo data. Backfills entries
 * in the same "entity.verb" shape recordAudit() itself would have written,
 * looked up by the same stable business keys used above so this stays
 * idempotent.
 */
async function seedDemoAuditTrail(adminUserId: string): Promise<void> {
  const ridge = await prisma.property.findUniqueOrThrow({
    where: { internalCode: "DEMO-001" },
  });
  const loft = await prisma.property.findUniqueOrThrow({
    where: { internalCode: "DEMO-002" },
  });
  const reservation1 = await prisma.reservation.findFirstOrThrow({
    where: { source: "DIRECT", externalReservationId: "DEMO-RES-001" },
  });
  const maintenanceRequest = await prisma.maintenanceRequest.findFirstOrThrow({
    where: {
      propertyId: ridge.id,
      description: "Kitchen faucet drips steadily",
    },
  });
  const dueTodayTask = await prisma.task.findFirstOrThrow({
    where: { title: "Restock welcome basket — Cabin on the Ridge" },
  });

  const entries: Array<{
    action: string;
    entityType: string;
    entityId: string;
    afterState: Record<string, unknown>;
  }> = [
    {
      action: "property.created",
      entityType: "Property",
      entityId: ridge.id,
      afterState: { name: ridge.name, status: ridge.status },
    },
    {
      action: "property.created",
      entityType: "Property",
      entityId: loft.id,
      afterState: { name: loft.name, status: loft.status },
    },
    {
      action: "reservation.created",
      entityType: "Reservation",
      entityId: reservation1.id,
      afterState: { status: reservation1.status },
    },
    {
      action: "maintenance_request.reported",
      entityType: "MaintenanceRequest",
      entityId: maintenanceRequest.id,
      afterState: {
        status: maintenanceRequest.status,
        category: maintenanceRequest.category,
      },
    },
    {
      action: "task.created",
      entityType: "Task",
      entityId: dueTodayTask.id,
      afterState: { title: dueTodayTask.title, status: dueTodayTask.status },
    },
  ];

  for (const entry of entries) {
    const existing = await prisma.auditLog.findFirst({
      where: { action: entry.action, entityId: entry.entityId },
    });
    if (existing) continue;

    await prisma.auditLog.create({
      data: {
        actorUserId: adminUserId,
        actorType: "USER",
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        afterState: entry.afterState as Prisma.InputJsonValue,
        occurredAt: new Date(),
      },
    });
  }
}

async function seedDemoNotifications(adminUserId: string): Promise<void> {
  const demoNotifications: Array<{
    type:
      | "TASK_ASSIGNED"
      | "RESERVATION_UPDATE"
      | "MAINTENANCE_ALERT"
      | "MESSAGE_RECEIVED";
    title: string;
    body: string;
    read: boolean;
  }> = [
    {
      type: "RESERVATION_UPDATE",
      title: "Guest arriving today",
      body: "Jordan Rivera checks in today at Cabin on the Ridge.",
      read: false,
    },
    {
      type: "MAINTENANCE_ALERT",
      title: "New maintenance request",
      body: "Kitchen faucet drips steadily — Cabin on the Ridge.",
      read: false,
    },
    {
      type: "TASK_ASSIGNED",
      title: "Task due today",
      body: "Restock welcome basket — Cabin on the Ridge.",
      read: true,
    },
  ];

  for (const n of demoNotifications) {
    const existing = await prisma.notification.findFirst({
      where: { userId: adminUserId, title: n.title },
    });
    if (existing) continue;

    await prisma.notification.create({
      data: {
        userId: adminUserId,
        type: n.type,
        title: n.title,
        body: n.body,
        channel: "IN_APP",
        status: "SENT",
        sentAt: new Date(),
        readAt: n.read ? new Date() : null,
      },
    });
  }
}

async function seedDemoCommunications(input: {
  property: { id: string };
  guest: { id: string };
}): Promise<void> {
  const subject = "Check-in details — Cabin on the Ridge";
  const existing = await prisma.messageThread.findFirst({ where: { subject } });
  if (existing) return;

  await prisma.$transaction(async (tx) => {
    const thread = await tx.messageThread.create({
      data: {
        subject,
        channel: "IN_APP",
        propertyId: input.property.id,
        guestId: input.guest.id,
        status: "OPEN",
      },
    });
    await tx.message.create({
      data: {
        threadId: thread.id,
        direction: "INBOUND",
        senderGuestId: input.guest.id,
        body: "Hi! What time can we check in today, and is there parking?",
        sentAt: new Date(),
      },
    });
  });
}

/**
 * Clearly-fictional smart devices so the dashboard's device-health section
 * has something real to query when no live August/Cielo connection is
 * configured yet. Both packages/integrations clients are now real (see
 * their READMEs) — PROVIDER_CLIENT_STATUS reports AUGUST/CIELO as "real" as
 * soon as AUGUST_ACCESS_TOKEN / CIELO_USERNAME+PASSWORD exist, which would
 * mislabel these fake rows as live if they were still sitting in the table.
 * So: only seed a provider's demo rows while its real credentials are
 * absent, and delete any leftover demo rows the moment they appear — a real
 * sync (see smart-devices.service.ts) is what actually replaces them with
 * live data, but this keeps the table honest even before that first sync
 * runs. Deliberately includes one offline lock, one low-battery lock, one
 * offline thermostat, and one lock that's both, so "is there a device
 * problem right now" has a real non-empty answer to demo.
 */
async function seedDemoSmartDevices(
  ridgePropertyId: string,
  loftPropertyId: string,
): Promise<void> {
  const augustConfigured = Boolean(process.env.AUGUST_ACCESS_TOKEN);
  const cieloConfigured = Boolean(
    process.env.CIELO_USERNAME && process.env.CIELO_PASSWORD,
  );

  const devices: Array<{
    propertyId: string;
    provider: "AUGUST" | "CIELO";
    deviceType: "LOCK" | "THERMOSTAT";
    externalDeviceId: string;
    name: string;
    status: "ONLINE" | "OFFLINE";
    batteryLevel?: number;
  }> = [
    {
      propertyId: ridgePropertyId,
      provider: "AUGUST",
      deviceType: "LOCK",
      externalDeviceId: "demo-august-ridge-front",
      name: "Front Door",
      status: "ONLINE",
      batteryLevel: 85,
    },
    {
      propertyId: ridgePropertyId,
      provider: "AUGUST",
      deviceType: "LOCK",
      externalDeviceId: "demo-august-ridge-back",
      name: "Back Door",
      status: "OFFLINE",
      batteryLevel: 62,
    },
    {
      propertyId: ridgePropertyId,
      provider: "CIELO",
      deviceType: "THERMOSTAT",
      externalDeviceId: "demo-cielo-ridge-living",
      name: "Living Room",
      status: "ONLINE",
    },
    {
      propertyId: loftPropertyId,
      provider: "AUGUST",
      deviceType: "LOCK",
      externalDeviceId: "demo-august-loft-front",
      name: "Front Door",
      status: "ONLINE",
      batteryLevel: 15,
    },
    {
      propertyId: loftPropertyId,
      provider: "CIELO",
      deviceType: "THERMOSTAT",
      externalDeviceId: "demo-cielo-loft-main",
      name: "Main",
      status: "OFFLINE",
    },
    // Deliberately both offline AND critically low battery — the other
    // four devices only demo one attention-worthy state at a time
    // (offline-only, low-battery-only, or neither); this is the only one
    // that demos the combined "Offline + low battery" wording.
    {
      propertyId: loftPropertyId,
      provider: "AUGUST",
      deviceType: "LOCK",
      externalDeviceId: "demo-august-loft-side",
      name: "Side Door",
      status: "OFFLINE",
      batteryLevel: 8,
    },
  ];

  for (const device of devices) {
    const configured =
      device.provider === "AUGUST" ? augustConfigured : cieloConfigured;
    if (configured) continue;

    await prisma.smartDevice.upsert({
      where: {
        provider_externalDeviceId: {
          provider: device.provider,
          externalDeviceId: device.externalDeviceId,
        },
      },
      update: {
        status: device.status,
        metadata:
          device.batteryLevel != null
            ? { batteryLevel: device.batteryLevel }
            : {},
        lastSeenAt: device.status === "ONLINE" ? new Date() : undefined,
      },
      create: {
        propertyId: device.propertyId,
        provider: device.provider,
        deviceType: device.deviceType,
        externalDeviceId: device.externalDeviceId,
        name: device.name,
        status: device.status,
        metadata:
          device.batteryLevel != null
            ? { batteryLevel: device.batteryLevel }
            : {},
        lastSeenAt: device.status === "ONLINE" ? new Date() : undefined,
      },
    });
  }

  if (augustConfigured) {
    await prisma.smartDevice.deleteMany({
      where: { provider: "AUGUST", externalDeviceId: { startsWith: "demo-" } },
    });
  }
  if (cieloConfigured) {
    await prisma.smartDevice.deleteMany({
      where: { provider: "CIELO", externalDeviceId: { startsWith: "demo-" } },
    });
  }
}

/**
 * A demo AI conversation showing what the ops-assistant thread looks like
 * — a real user question, followed by the exact SYSTEM notice sendAiMessage
 * actually produces when ANTHROPIC_API_KEY isn't set (packages/ai's
 * NotImplementedError path). Not a fabricated AI reply — this is precisely
 * what the app would generate on its own today, just precomputed for the
 * demo instead of waiting for a real click.
 */
async function seedDemoAiConversation(): Promise<void> {
  const subject = "Today's arrivals and departures";
  const existing = await prisma.aiConversation.findFirst({
    where: { subject },
  });
  if (existing) return;

  await prisma.$transaction(async (tx) => {
    const conversation = await tx.aiConversation.create({
      data: {
        subject,
        context: "OPS_ASSISTANT",
        model: "claude-sonnet-5",
        status: "ACTIVE",
      },
    });
    await tx.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content: "What's arriving and departing today?",
      },
    });
    await tx.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: "SYSTEM",
        content:
          "The AI assistant isn't configured yet — an administrator needs to set ANTHROPIC_API_KEY.",
      },
    });
  });
}

/** Guest.email isn't unique in the schema (real guests can share an email, e.g. a couple booking together), so it can't be an upsert `where` — findFirst-then-create is the idempotent equivalent used throughout this seed's demo data. */
async function upsertDemoGuest(input: {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
}) {
  const existing = await prisma.guest.findFirst({
    where: { email: input.email },
  });
  if (existing) return existing;

  return prisma.guest.create({ data: input });
}

/**
 * Dates are relative to "today," so on every re-run this updates the
 * existing demo reservation's dates/status/amount in place (keyed by the
 * stable `externalReservationId`) rather than only creating it once —
 * otherwise the demo would drift out of "arriving/departing today" the
 * day after it was first seeded.
 */
async function upsertDemoReservation(input: {
  externalReservationId: string;
  propertyId: string;
  guestId: string;
  status: "PENDING" | "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED";
  checkInDate: Date;
  checkOutDate: Date;
  totalAmount: number;
}): Promise<void> {
  const existing = await prisma.reservation.findFirst({
    where: {
      source: "DIRECT",
      externalReservationId: input.externalReservationId,
    },
  });

  if (existing) {
    await prisma.reservation.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        checkInDate: input.checkInDate,
        checkOutDate: input.checkOutDate,
        totalAmount: input.totalAmount,
      },
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.create({
      data: {
        propertyId: input.propertyId,
        primaryGuestId: input.guestId,
        source: "DIRECT",
        externalReservationId: input.externalReservationId,
        status: input.status,
        checkInDate: input.checkInDate,
        checkOutDate: input.checkOutDate,
        totalAmount: input.totalAmount,
      },
    });
    await tx.reservationGuest.create({
      data: {
        reservationId: reservation.id,
        guestId: input.guestId,
        isPrimary: true,
      },
    });
  });
}

/** Same "refresh on every run" reasoning as upsertDemoReservation — keyed by a stable `slug` (stored as the backing Task's title suffix) rather than the scheduledDate itself, since that date is exactly what needs to move forward on re-runs. */
async function upsertDemoCleaningSchedule(input: {
  slug: string;
  property: { id: string; name: string };
  scheduledDate: Date;
  originalScheduledDate?: Date;
  cleaningType:
    "TURNOVER" | "DEEP_CLEAN" | "INSPECTION_CLEAN" | "MAINTENANCE_CLEAN";
  createdByUserId: string;
}): Promise<void> {
  const title = `Turnover clean — ${input.property.name} [${input.slug}]`;
  const existingTask = await prisma.task.findFirst({
    where: { title },
    include: { cleaningSchedule: true },
  });

  if (existingTask?.cleaningSchedule) {
    await prisma.cleaningSchedule.update({
      where: { id: existingTask.cleaningSchedule.id },
      data: {
        scheduledDate: input.scheduledDate,
        cleaningType: input.cleaningType,
        originalScheduledDate: input.originalScheduledDate ?? null,
      },
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        title,
        type: "CLEANING",
        propertyId: input.property.id,
        createdByUserId: input.createdByUserId,
      },
    });
    await tx.cleaningSchedule.create({
      data: {
        propertyId: input.property.id,
        taskId: task.id,
        scheduledDate: input.scheduledDate,
        originalScheduledDate: input.originalScheduledDate ?? null,
        cleaningType: input.cleaningType,
      },
    });
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
