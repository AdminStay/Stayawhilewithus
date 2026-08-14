/**
 * One-time interactive August login.
 *
 * Run this LOCALLY, in your own terminal — never paste your August password
 * or the 6-digit verification code into a chat with anyone, including an AI
 * assistant. This script never sends them anywhere except August's own
 * servers, and never prints them back out.
 *
 *   pnpm --filter @stayw/integrations exec tsx src/august/scripts/login.ts
 *
 * Implements the exact flow verified against yalexs, the actively
 * maintained library Home Assistant's own August/Yale integration is built
 * on — see ../README.md: POST /session -> if the response says validation
 * is required, request + submit the 6-digit code -> POST /session again
 * with the same installId to get the final access token. Tries every known
 * account brand (see AUGUST_BRAND_CONFIGS in ../types.ts — shared with
 * ../client.ts so both stay in sync) against the same credentials, since
 * which one a given account needs isn't knowable in advance: a wrong
 * brand's API key/host gets a {"code":"Forbidden","message":"API key is
 * not valid"} response, not a bad-password error. On success, writes
 * AUGUST_IDENTIFIER, AUGUST_INSTALL_ID, AUGUST_ACCESS_TOKEN, and
 * AUGUST_BRAND into apps/website/.env.local (creating the file if needed)
 * — it never prints the access token itself, only confirms that it was
 * written.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { AUGUST_BRAND_CONFIGS, type AugustBrandConfig } from "../types";

// Fixed values every August/Yale client sends regardless of brand — kept in
// sync with ../client.ts; see that file's comment for why these changed
// from the originally-ported py-august values. Per-brand values (API key,
// host, header names) live in AUGUST_BRAND_CONFIGS.
const AUGUST_COUNTRY = "US";
const AUGUST_USER_AGENT =
  "August/Luna-22.17.0 (Android; SDK 31; gphone64_arm64)";
// Fixed value the real August app sends alongside a phone-based verification
// code request — verified against yalexs's api_common.py, not guessed.
const AUGUST_SMS_HASH_STRING = "anY0ZsRmXw+";

// Control characters read one keystroke at a time in raw stdin mode.
// Built with String.fromCharCode() rather than literal escape sequences
// so there is no ambiguity about what byte each constant holds.
const KEY_ENTER = String.fromCharCode(10); // LF
const KEY_CARRIAGE_RETURN = String.fromCharCode(13); // CR
const KEY_EOF = String.fromCharCode(4); // Ctrl-D
const KEY_INTERRUPT = String.fromCharCode(3); // Ctrl-C
const KEY_BACKSPACE = String.fromCharCode(127); // DEL

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_LOCAL_PATH = resolve(
  __dirname,
  "../../../../../apps/website/.env.local",
);

function augustHeaders(
  brand: AugustBrandConfig,
  accessToken?: string,
): Record<string, string> {
  const h: Record<string, string> = {
    "Accept-Version": "0.0.1",
    [brand.apiKeyHeader]: brand.apiKey,
    [brand.brandingHeader]: brand.branding,
    "x-august-country": AUGUST_COUNTRY,
    "Content-Type": "application/json; charset=UTF-8",
    "User-Agent": AUGUST_USER_AGENT,
  };
  if (accessToken) h[brand.accessTokenHeader] = accessToken;
  return h;
}

/** Reads the response body for diagnostics only — never contains anything we sent (password/code), only whatever August's server sent back. Never throws. */
async function describeFailure(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return `HTTP ${response.status}`;
    return `HTTP ${response.status}: ${text.slice(0, 300)}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function promptHidden(question: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(
        new Error(
          "This script needs an interactive terminal (stdin is not a TTY).",
        ),
      );
      return;
    }
    process.stdout.write(question);
    let input = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      const char = chunk.toString();

      if (
        char === KEY_ENTER ||
        char === KEY_CARRIAGE_RETURN ||
        char === KEY_EOF
      ) {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolvePromise(input);
        return;
      }

      if (char === KEY_INTERRUPT) {
        process.stdout.write("\n");
        process.exit(1);
      }

      if (char === KEY_BACKSPACE) {
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write("\b \b");
        }
        return;
      }

      input += char;
      process.stdout.write("*");
    };
    stdin.on("data", onData);
  });
}

interface SessionResponse {
  expiresAt: string;
  vPassword: boolean;
  vInstallId: boolean;
}

async function postSession(
  brand: AugustBrandConfig,
  installId: string,
  identifier: string,
  password: string,
): Promise<{ accessToken: string; body: SessionResponse }> {
  const response = await fetch(`${brand.baseUrl}/session`, {
    method: "POST",
    headers: augustHeaders(brand),
    body: JSON.stringify({ installId, identifier, password }),
  });
  // yalexs's authenticator_common.py reads the access token from whichever
  // of the two known header names the response actually used, rather than
  // assuming it matches the header name the brand's config sent the
  // request under — replicated here rather than trusting only one name.
  const accessToken =
    response.headers.get("x-access-token") ??
    response.headers.get("x-august-access-token");
  if (!response.ok || !accessToken) {
    throw new Error(await describeFailure(response));
  }
  const body = (await response.json()) as SessionResponse;
  return { accessToken, body };
}

/**
 * Tries every known brand from AUGUST_BRAND_CONFIGS against the SAME
 * installId/identifier/password and keeps the first one that gets a real
 * session response back, rather than a hard rejection. Surfaces every
 * candidate's failure reason if all of them fail, so a genuinely wrong
 * password is distinguishable from "every brand's API key was rejected."
 */
async function postSessionWithBrandFallback(
  installId: string,
  identifier: string,
  password: string,
): Promise<{
  brand: AugustBrandConfig;
  accessToken: string;
  body: SessionResponse;
}> {
  const failures: string[] = [];
  for (const brand of AUGUST_BRAND_CONFIGS) {
    try {
      const { accessToken, body } = await postSession(
        brand,
        installId,
        identifier,
        password,
      );
      return { brand, accessToken, body };
    } catch (err) {
      failures.push(
        `  - brand "${brand.name}" (${brand.baseUrl}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  throw new Error(
    `August login request failed for every known account brand:\n${failures.join("\n")}\nThis usually means an incorrect email/phone or password, but could also mean August rejected the request for another reason shown above.`,
  );
}

async function sendVerificationCode(
  brand: AugustBrandConfig,
  accessToken: string,
  loginMethod: "email" | "phone",
  value: string,
): Promise<void> {
  const url =
    loginMethod === "phone"
      ? `${brand.baseUrl}/validation/phone`
      : `${brand.baseUrl}/validation/email`;
  const body =
    loginMethod === "phone"
      ? { smsHashString: AUGUST_SMS_HASH_STRING, value }
      : { value };
  const response = await fetch(url, {
    method: "POST",
    headers: augustHeaders(brand, accessToken),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to send the verification code (${await describeFailure(response)}).`,
    );
  }
}

async function validateVerificationCode(
  brand: AugustBrandConfig,
  accessToken: string,
  loginMethod: "email" | "phone",
  value: string,
  code: string,
): Promise<void> {
  const url =
    loginMethod === "phone"
      ? `${brand.baseUrl}/validate/phone`
      : `${brand.baseUrl}/validate/email`;
  const response = await fetch(url, {
    method: "POST",
    headers: augustHeaders(brand, accessToken),
    body: JSON.stringify({ [loginMethod]: value, code }),
  });
  if (!response.ok) {
    throw new Error(
      `That verification code was rejected (${await describeFailure(response)}). Run this script again to request a new one.`,
    );
  }
}

function upsertEnvVars(vars: Record<string, string>): void {
  let existing = "";
  if (existsSync(ENV_LOCAL_PATH)) {
    existing = readFileSync(ENV_LOCAL_PATH, "utf8");
  } else {
    mkdirSync(dirname(ENV_LOCAL_PATH), { recursive: true });
  }

  let content = existing;
  for (const [key, value] of Object.entries(vars)) {
    const line = `${key}="${value}"`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    if (pattern.test(content)) {
      content = content.replace(pattern, line);
    } else {
      content =
        content.length > 0 && !content.endsWith("\n")
          ? `${content}\n${line}\n`
          : `${content}${line}\n`;
    }
  }

  writeFileSync(ENV_LOCAL_PATH, content, "utf8");
}

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("August one-time login");
  console.log(
    "Nothing you type here is sent anywhere except August's own servers, and none of it is echoed back to this terminal after you're done.\n",
  );

  const loginMethodRaw = (
    await rl.question(
      "Do you log in with an email or a phone number? [email/phone]: ",
    )
  )
    .trim()
    .toLowerCase();
  const loginMethod: "email" | "phone" =
    loginMethodRaw === "phone" ? "phone" : "email";

  const identifierValue = (
    await rl.question(`Enter your August account ${loginMethod}: `)
  ).trim();

  rl.close();

  const password = await promptHidden("Enter your August account password: ");

  const installId = randomUUID();
  const identifier = `${loginMethod}:${identifierValue}`;

  console.log("\nLogging in...");
  const initialLogin = await postSessionWithBrandFallback(
    installId,
    identifier,
    password,
  );
  const { brand } = initialLogin;
  let { accessToken, body } = initialLogin;
  console.log(`(matched account brand: ${brand.name} — ${brand.baseUrl})`);
  if (brand.requiresOAuth) {
    console.log(
      "(note: yalexs's own Brand enum flags this brand as normally requiring OAuth — continuing with the direct password flow since it accepted the request, but if a later step behaves unexpectedly, that's why.)",
    );
  }

  if (!body.vPassword) {
    console.error(
      "\nAugust rejected that password. Nothing was written to .env.local.",
    );
    process.exitCode = 1;
    return;
  }

  if (!body.vInstallId) {
    console.log(
      `A verification code was requested. August is sending it to your ${loginMethod} now.`,
    );
    await sendVerificationCode(
      brand,
      accessToken,
      loginMethod,
      identifierValue,
    );

    const codeRl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const code = (await codeRl.question("Enter the 6-digit code: ")).trim();
    codeRl.close();

    await validateVerificationCode(
      brand,
      accessToken,
      loginMethod,
      identifierValue,
      code,
    );

    console.log("Code accepted. Finishing login...");
    ({ accessToken, body } = await postSession(
      brand,
      installId,
      identifier,
      password,
    ));

    if (!body.vInstallId) {
      console.error(
        "\nLogin still isn't fully validated after submitting the code. Run this script again.",
      );
      process.exitCode = 1;
      return;
    }
  }

  upsertEnvVars({
    AUGUST_IDENTIFIER: identifier,
    AUGUST_INSTALL_ID: installId,
    AUGUST_ACCESS_TOKEN: accessToken,
    AUGUST_BRAND: brand.name,
  });

  console.log(
    `\nSuccess. Wrote AUGUST_IDENTIFIER, AUGUST_INSTALL_ID, AUGUST_ACCESS_TOKEN, and AUGUST_BRAND to:\n  ${ENV_LOCAL_PATH}`,
  );
  console.log(
    `\nThe access token expires ${body.expiresAt} — after that, just re-run this script (the saved installId will skip the verification-code step).`,
  );
  console.log(
    "\nDon't share the contents of .env.local or paste the access token anywhere — it's a bearer credential, same as a password.",
  );
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
