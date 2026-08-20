/**
 * One-off, read-only dump of the full OwnerRez Production property
 * inventory, for building the OwnerRez <-> StayWhile match report.
 * Prompts interactively for credentials — nothing on the command line,
 * nothing written to disk, nothing read from .env.local:
 *
 *   npx tsx scripts/ownerrez-property-inventory.ts
 *
 * Makes exactly one call: listProperties() -> GET /properties.
 * Prints id, name, key, active for every property. Never writes to
 * OwnerRez, never touches the StayWhile database.
 *
 * Deletes itself after a successful run.
 */
import { fileURLToPath } from "node:url";
import { unlink } from "node:fs/promises";
import * as readline from "node:readline";

import { OwnerrezClient } from "../src/ownerrez/client";

const CHAR_CODE = {
  ctrlC: 3,
  ctrlD: 4,
  backspace: 8,
  lineFeed: 10,
  carriageReturn: 13,
  del: 127,
} as const;

function promptVisible(query: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptHidden(query: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(
        new Error(
          "This script needs an interactive terminal to hide the token as you type it.",
        ),
      );
      return;
    }

    process.stdout.write(query);
    let value = "";

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onData = (chunk: string) => {
      const code = chunk.charCodeAt(0);

      if (code === CHAR_CODE.lineFeed || code === CHAR_CODE.carriageReturn) {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(value.trim());
        return;
      }

      if (code === CHAR_CODE.ctrlD) {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(value.trim());
        return;
      }

      if (code === CHAR_CODE.ctrlC) {
        stdin.setRawMode(false);
        stdin.pause();
        process.stdout.write("\n");
        process.exit(1);
      }

      if (code === CHAR_CODE.backspace || code === CHAR_CODE.del) {
        value = value.slice(0, -1);
        return;
      }

      value += chunk;
    };

    stdin.on("data", onData);
  });
}

async function main() {
  const username = await promptVisible("OwnerRez username: ");
  const token = await promptHidden("OwnerRez API token (hidden): ");

  if (!username || !token) {
    console.error("Both username and token are required.");
    process.exit(1);
  }

  const client = new OwnerrezClient({ username, token });

  const properties = await client.listProperties();
  console.log("Property count:", properties.length);
  console.log(
    "Properties:",
    JSON.stringify(
      properties.map((p) => ({
        id: p.id,
        name: p.name,
        key: p.key,
        active: p.active,
      })),
      null,
      2,
    ),
  );

  const scriptPath = fileURLToPath(import.meta.url);
  await unlink(scriptPath);
  console.log("Diagnostic script self-deleted after successful run.");
}

main().catch((err) => {
  console.error(
    "OwnerRez inventory dump failed:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
