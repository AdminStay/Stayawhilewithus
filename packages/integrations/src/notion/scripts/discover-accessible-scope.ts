/**
 * Read-only, one-time discovery of what Notion content the StayWhile
 * integration can currently see — used to answer "what's actually shared
 * with this integration" before designing a broader search feature, without
 * assuming the whole workspace is available. Uses NotionClient.search()
 * with no query (real, paginated /search, same discipline as every other
 * paginated read in this client) and prints only non-sensitive metadata
 * already safe to show on the dashboard today (titles, object/source type,
 * last-edited time) — never page/block content, never a property value
 * beyond a title, never NOTION_API_KEY.
 *
 * Local dev usage (reads NOTION_API_KEY from apps/website/.env.local if not
 * already set):
 *
 *   pnpm --filter @stayw/integrations exec tsx src/notion/scripts/discover-accessible-scope.ts
 *
 * Production verification (paste the real Production value inline — never
 * into a file, never committed, never logged by this script):
 *
 *   NOTION_API_KEY="<production value>" \
 *     pnpm --filter @stayw/integrations exec tsx src/notion/scripts/discover-accessible-scope.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { NotionClient, type NotionSearchResultItem } from "../client";

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

function groupBySourceType(
  items: NotionSearchResultItem[],
): Record<NotionSearchResultItem["sourceType"], NotionSearchResultItem[]> {
  const groups: Record<
    NotionSearchResultItem["sourceType"],
    NotionSearchResultItem[]
  > = { database: [], database_row: [], page: [] };
  for (const item of items) groups[item.sourceType].push(item);
  return groups;
}

async function main(): Promise<void> {
  loadEnvLocal();

  const token = process.env.NOTION_API_KEY;
  if (!token) {
    console.log("configured: no (missing NOTION_API_KEY)");
    process.exitCode = 1;
    return;
  }
  console.log("configured: yes");

  const client = new NotionClient({ token });

  try {
    const items = await client.search({ maxPages: 50 });
    console.log(`read: success`);
    console.log(`total accessible objects: ${items.length}\n`);

    const groups = groupBySourceType(items);
    for (const [sourceType, group] of Object.entries(groups)) {
      console.log(`${sourceType} (${group.length}):`);
      for (const item of group) {
        console.log(
          `  - [${item.id}] ${item.title}${item.lastEditedTime ? ` (last edited ${item.lastEditedTime})` : ""}`,
        );
      }
      console.log("");
    }
  } catch (err) {
    console.log("read: failure");
    console.log(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
