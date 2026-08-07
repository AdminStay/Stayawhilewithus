import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Bootstrap/admin mechanism for granting a role to a real signed-in user.
 *
 * Clerk sign-in only authenticates and JIT-provisions a `User` row with
 * zero `UserRole` assignments (see apps/website/src/platform/auth/get-
 * current-user.ts) — authentication is deliberately kept separate from
 * authorization, so every domain service's `assertPermission()` call
 * fails for a brand new sign-in until an operator explicitly runs this.
 * No login path grants a role automatically.
 *
 * Usage: pnpm --filter @stayw/database db:grant-role -- --email <email> --role <roleName> [--property <propertyId>]
 */

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue; // pnpm forwards this literal marker on some versions
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for --${key}`);
      }
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

async function main() {
  const {
    email,
    role: roleName,
    property: propertyId,
  } = parseArgs(process.argv.slice(2));

  if (!email || !roleName) {
    console.error(
      "Usage: pnpm --filter @stayw/database db:grant-role -- --email <email> --role <roleName> [--property <propertyId>]",
    );
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const allEmails = await prisma.user.findMany({ select: { email: true } });
    throw new Error(
      `No user found with email "${email}". They must sign in via Clerk at least once first ` +
        `(getCurrentUser() JIT-provisions the row on first authenticated request). ` +
        `Known users: ${allEmails.map((u) => u.email).join(", ") || "(none)"}`,
    );
  }

  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    const allRoles = await prisma.role.findMany({ select: { name: true } });
    throw new Error(
      `No role named "${roleName}". Valid roles: ${allRoles.map((r) => r.name).join(", ")}`,
    );
  }

  if (propertyId) {
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
    });
    if (!property) {
      throw new Error(`No property found with id "${propertyId}".`);
    }
  }

  const existing = await prisma.userRole.findFirst({
    where: { userId: user.id, roleId: role.id, propertyId: propertyId ?? null },
  });
  if (existing) {
    console.log(
      `"${email}" already has role "${roleName}"${propertyId ? ` on property ${propertyId}` : " (global)"}. Nothing to do.`,
    );
    return;
  }

  await prisma.userRole.create({
    data: { userId: user.id, roleId: role.id, propertyId: propertyId ?? null },
  });

  console.log(
    `Granted "${roleName}"${propertyId ? ` on property ${propertyId}` : " (global)"} to "${email}".`,
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
