import { z } from "zod";

/**
 * Runtime env validation — fails fast on boot instead of surfacing as a
 * confusing runtime error deep in a request handler. Every var consumed
 * anywhere in the app must be declared here. See .env.example for the
 * full documented list (including provider keys not yet required).
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),

  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1),
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: z.string().default("/sign-in"),
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: z.string().default("/sign-up"),

  N8N_BASE_URL: z.string().url(),
  N8N_WEBHOOK_SHARED_SECRET: z.string().min(1),
  N8N_INBOUND_WEBHOOK_SHARED_SECRET: z.string().min(1),

  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      "Invalid environment variables:",
      parsed.error.flatten().fieldErrors,
    );
    throw new Error(
      "Invalid environment variables — see .env.example and fix your .env file.",
    );
  }
  return parsed.data;
}

export const env = loadEnv();
