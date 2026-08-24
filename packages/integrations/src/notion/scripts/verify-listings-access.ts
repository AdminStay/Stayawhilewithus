/**
 * Real, read-only proof that a specific Notion data source (e.g. Michelle's
 * "View of Listings" property database) is shared with the StayWhile
 * integration and readable — one row max, never a content dump, never a
 * write. See ../README.md's "queryDataSource()" section for the full design
 * and HANDOFF.md Increments 43-46 for the investigation that led here.
 *
 * Local dev usage (reads NOTION_API_KEY / NOTION_LISTINGS_DATA_SOURCE_ID from
 * apps/website/.env.local if not already set):
 *
 *   pnpm --filter @stayw/integrations exec tsx src/notion/scripts/verify-listings-access.ts
 *
 * Production verification (paste real Production values inline — never into
 * a file, never committed, never logged by this script):
 *
 *   NOTION_API_KEY="<production value>" NOTION_LISTINGS_DATA_SOURCE_ID="<production value>" \
 *     pnpm --filter @stayw/integrations exec tsx src/notion/scripts/verify-listings-access.ts
 *
 * Prints only: configured yes/no, success/failure, result count, and (on
 * success) one safe title. Never prints NOTION_API_KEY, never prints
 * NOTION_LISTINGS_DATA_SOURCE_ID, never prints row/page content.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { NotionClient } from "../client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_LOCAL_PATH = resolve(
  __dirname,
  "../../../../../apps/website/.env.local",
);

function loadEnvLocal(): void {
  if (!existsSync(ENV_LOCAL_PATH)) return;
  const content = readFileSync(ENV_LOCAL_PATH, "utf8");
  for (const line of content.split("\n")) {
    const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (key && value !== undefined && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function classifyFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  const status = /failed with (\d+)/.exec(message)?.[1];
  if (status === "401") return "unauthorized (token invalid/revoked)";
  if (status === "404")
    return "not_found_or_no_access (database not shared with this integration, or the data source ID is wrong — Notion returns the same status for both, by design)";
  if (status === "400") return "version_or_validation_error";
  return "unexpected_error";
}

async function main(): Promise<void> {
  loadEnvLocal();

  const token = process.env.NOTION_API_KEY;
  const dataSourceId = process.env.NOTION_LISTINGS_DATA_SOURCE_ID;

  if (!token || !dataSourceId) {
    console.log("configured: no");
    console.log(
      !token
        ? "  missing: NOTION_API_KEY"
        : "  missing: NOTION_LISTINGS_DATA_SOURCE_ID",
    );
    process.exitCode = 1;
    return;
  }
  console.log("configured: yes");

  const client = new NotionClient({ token });

  try {
    const { resultCount, firstTitle } = await client.queryDataSource(
      dataSourceId,
      1,
    );
    console.log("read: success");
    console.log(`result count: ${resultCount}`);
    if (firstTitle) console.log(`first title: ${firstTitle}`);
  } catch (err) {
    console.log("read: failure");
    console.log(`reason: ${classifyFailure(err)}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
