/**
 * Daily lock-health digest (2026-09-26, Michelle's daily monitoring
 * requirement). Pure: turns the same classifyLockHealth() flags the /locks
 * "Needs attention" list shows into ONE exception summary — never one item
 * per lock per day for healthy locks, never a second polling system (the
 * input comes from the existing 6-hourly August refresh snapshots).
 *
 * Duplicate suppression: every lock + condition gets a stable key
 * (`<smartDeviceId>:<flagCode>`). Given the previous digest's keys, each item
 * is marked NEW or ONGOING, and conditions that disappeared are listed as
 * RESOLVED — so a delivery channel can update one running item instead of
 * re-alerting on the same unresolved condition. `fingerprint` changes only
 * when the set of conditions changes.
 *
 * Delivery (Asana task, email, …) is deliberately NOT here: the existing
 * Asana adapter is inbound/read-only, so outbound delivery is a separate,
 * explicitly approved step.
 */
import type {
  LockHealthFlag,
  LockHealthFlagCode,
  LockHealthSeverity,
} from "./lock-health";

export interface DigestInputRow {
  smartDeviceId: string;
  propertyName: string;
  lockName: string;
  flags: LockHealthFlag[];
}

export interface DigestItem {
  conditionKey: string;
  propertyName: string;
  lockName: string;
  label: string;
  detail: string;
  since: string | null;
  status: "NEW" | "ONGOING";
}

export interface DigestSection {
  severity: LockHealthSeverity;
  heading: string;
  items: DigestItem[];
}

export interface LockHealthDigest {
  generatedAt: string;
  hasExceptions: boolean;
  counts: Record<LockHealthSeverity, number>;
  sections: DigestSection[];
  resolvedConditionKeys: string[];
  conditionKeys: string[];
  fingerprint: string;
  title: string;
  text: string;
}

const SECTION_ORDER: Array<{
  heading: string;
  emoji: string;
  severity: LockHealthSeverity;
  codes: LockHealthFlagCode[];
}> = [
  {
    heading: "Out of service / onsite inspection",
    emoji: "🔴",
    severity: "red",
    codes: ["OPERATIONAL_HOLD"],
  },
  {
    heading: "Door open + unlocked",
    emoji: "🔴",
    severity: "red",
    codes: ["DOOR_OPEN_UNLOCKED"],
  },
  {
    heading: "Unlocked (occupancy not yet considered)",
    emoji: "🔴",
    severity: "red",
    codes: ["UNLOCKED"],
  },
  {
    heading: "Offline / no bridge",
    emoji: "🔴",
    severity: "red",
    codes: ["OFFLINE", "NO_BRIDGE"],
  },
  {
    heading: "Command blocked (needs in-person check + reset)",
    emoji: "🟠",
    severity: "orange",
    codes: ["COMMAND_BLOCKED"],
  },
  {
    heading: "Unknown lock state",
    emoji: "🟠",
    severity: "orange",
    codes: ["UNKNOWN_STATE"],
  },
  {
    heading: "Possible lock problem — check August app or inspect onsite",
    emoji: "🟠",
    severity: "orange",
    codes: ["POSSIBLE_LOCK_PROBLEM"],
  },
  {
    heading: "Low battery",
    emoji: "🟠",
    severity: "orange",
    codes: ["LOW_BATTERY"],
  },
  {
    heading: "Stale telemetry",
    emoji: "🟡",
    severity: "yellow",
    codes: ["STALE_LOCK_TELEMETRY", "STALE_BATTERY_TELEMETRY"],
  },
];

/** Small, dependency-free stable hash (FNV-1a) for change detection only. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function buildLockHealthDigest(
  rows: DigestInputRow[],
  options: { now: Date; previousConditionKeys?: string[] },
): LockHealthDigest {
  const previous = new Set(options.previousConditionKeys ?? []);
  const counts: Record<LockHealthSeverity, number> = {
    red: 0,
    orange: 0,
    yellow: 0,
  };
  const allKeys: string[] = [];

  const sections: DigestSection[] = SECTION_ORDER.map((section) => {
    const items: DigestItem[] = [];
    for (const row of rows) {
      for (const flag of row.flags) {
        if (!section.codes.includes(flag.code)) continue;
        const conditionKey = `${row.smartDeviceId}:${flag.code}`;
        allKeys.push(conditionKey);
        counts[flag.severity] += 1;
        items.push({
          conditionKey,
          propertyName: row.propertyName,
          lockName: row.lockName,
          label: flag.label,
          detail: flag.detail,
          since: flag.since,
          status: previous.has(conditionKey) ? "ONGOING" : "NEW",
        });
      }
    }
    items.sort(
      (a, b) =>
        a.propertyName.localeCompare(b.propertyName) ||
        a.lockName.localeCompare(b.lockName),
    );
    return {
      severity: section.severity,
      heading: `${section.emoji} ${section.heading}`,
      items,
    };
  }).filter((section) => section.items.length > 0);

  const conditionKeys = [...allKeys].sort();
  const current = new Set(conditionKeys);
  const resolvedConditionKeys = [...previous]
    .filter((key) => !current.has(key))
    .sort();
  const date = options.now.toISOString().slice(0, 10);
  const title = `🔐 Lock health — ${date} — ${counts.red} 🔴 · ${counts.orange} 🟠 · ${counts.yellow} 🟡`;

  const lines: string[] = [title, ""];
  for (const section of sections) {
    lines.push(section.heading);
    for (const item of section.items) {
      lines.push(
        ` • ${item.status === "NEW" ? "[NEW] " : ""}${item.propertyName} — ${item.lockName}: ${item.label}. ${item.detail}${item.since ? ` (since ${item.since})` : ""}`,
      );
    }
    lines.push("");
  }
  if (resolvedConditionKeys.length > 0) {
    lines.push(
      `✅ Resolved since last digest: ${resolvedConditionKeys.length}`,
      "",
    );
  }
  if (sections.length === 0) lines.push("✅ No lock health exceptions.", "");
  lines.push(
    "Generated from the read-only August refresh. No commands were sent.",
  );

  return {
    generatedAt: options.now.toISOString(),
    hasExceptions: sections.length > 0,
    counts,
    sections,
    resolvedConditionKeys,
    conditionKeys,
    fingerprint: fnv1a(conditionKeys.join("|")),
    title,
    text: lines.join("\n"),
  };
}
