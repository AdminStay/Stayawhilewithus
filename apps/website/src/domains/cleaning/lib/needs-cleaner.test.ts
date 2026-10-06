import { describe, expect, it } from "vitest";

import {
  jobsNeedingCleaner,
  NEEDS_CLEANER_DESCRIPTION,
  NEEDS_CLEANER_HREF,
  needsCleaner,
  needsCleanerTitle,
} from "./needs-cleaner";

const job = (id: string, status: string, cleanerId: string | null) => ({
  id,
  status,
  cleanerId,
});

describe("needsCleaner (Cleaner Phase 5.3)", () => {
  it("includes an open job with no cleaner", () => {
    expect(needsCleaner(job("a", "SCHEDULED", null))).toBe(true);
    expect(needsCleaner(job("b", "IN_PROGRESS", null))).toBe(true);
  });

  it("excludes an open job that has a cleaner", () => {
    expect(needsCleaner(job("a", "SCHEDULED", "c-alex"))).toBe(false);
  });

  it.each(["COMPLETED", "CANCELLED", "MISSED"])(
    "excludes a %s job even with no cleaner",
    (status) => {
      expect(needsCleaner(job("a", status, null))).toBe(false);
    },
  );

  // 2026-10-07: a deactivated stored cleaner isn't going to do the job.
  it("includes an open job whose stored cleaner is inactive", () => {
    expect(
      needsCleaner({
        ...job("a", "SCHEDULED", "c-old"),
        cleaner: { status: "INACTIVE" },
      }),
    ).toBe(true);
  });

  it("excludes an open job whose stored cleaner is active", () => {
    expect(
      needsCleaner({
        ...job("a", "IN_PROGRESS", "c-alex"),
        cleaner: { status: "ACTIVE" },
      }),
    ).toBe(false);
  });

  it.each(["COMPLETED", "CANCELLED", "MISSED"])(
    "excludes a %s job even when its cleaner is inactive",
    (status) => {
      expect(
        needsCleaner({
          ...job("a", status, "c-old"),
          cleaner: { status: "INACTIVE" },
        }),
      ).toBe(false);
    },
  );
});

describe("jobsNeedingCleaner", () => {
  it("returns only open, unassigned jobs — the correct count for several", () => {
    const jobs = [
      job("open-1", "SCHEDULED", null),
      job("open-2", "SCHEDULED", null),
      job("open-3", "IN_PROGRESS", null),
      job("assigned", "SCHEDULED", "c-alex"),
      job("done", "COMPLETED", null),
      job("cancelled", "CANCELLED", null),
      job("missed", "MISSED", null),
    ];

    const result = jobsNeedingCleaner(jobs);

    expect(result.map((j) => j.id)).toEqual(["open-1", "open-2", "open-3"]);
    expect(result).toHaveLength(3);
  });

  it("returns an empty list when nothing needs a cleaner", () => {
    expect(jobsNeedingCleaner([job("a", "SCHEDULED", "c-alex")])).toEqual([]);
  });
});

describe("attention text and link", () => {
  it("counts in the title (singular and plural)", () => {
    expect(needsCleanerTitle(1)).toBe("1 cleaning job needs attention");
    expect(needsCleanerTitle(3)).toBe("3 cleaning jobs need attention");
  });

  it("explains why and links to the filtered cleaning list", () => {
    expect(NEEDS_CLEANER_DESCRIPTION).toBe(
      "These jobs have no cleaner assigned, or their cleaner is inactive.",
    );
    expect(NEEDS_CLEANER_HREF).toBe("/cleaning?view=needs-cleaner");
  });
});
