import { PrismaClient, PermissionAction } from "@prisma/client";

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
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
