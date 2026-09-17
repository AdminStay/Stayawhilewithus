# Team domain — VA/team schedule & availability

## Status: Sheet access confirmed, real structure confirmed, real parser built & tested. Still blocked on identity mapping, timezone confirmation, and business decisions (placement/RBAC/refresh cadence) — none of which this domain can resolve on its own.

## The real Google Sheet — confirmed, not assumed

**URL/ID**: `https://docs.google.com/spreadsheets/d/1DNMYvmlY-I2rUOERlizjfmbfaw4RGVJDs8yrp_pRVv8/` — supplied 2026-09-16 (resolves the earlier "not yet received" discrepancy; see `HANDOFF.md`'s Increment 96/97 for the full record of that).

**Access**: confirmed publicly readable, read-only, via Google's own unauthenticated CSV export (`.../export?format=csv&gid=<id>`) — no login, no service account, no StayWhile Google credential of any kind was used or needed. Never wrote to the sheet; every request made was a `GET`.

**Tabs (2 total, confirmed by downloading the full workbook and reading its own internal `xl/workbook.xml`, not guessed)**:

- **`"2025"`** (gid `583841225`, the tab that was supplied) — despite the name, its real date range runs from **March 3, 2025 through at least October 4, 2026** (confirmed by scanning every date header actually present) — i.e. it **is** the live, current schedule; "2025" is a stale/legacy tab name, not a scope limit.
- **`"August 2026 Draft"`** (gid `1942890585`) — confirmed **completely empty** (0-byte export). Exists, unused.

## Actual structure — a calendar grid, not a row-per-shift list

Every week is a repeating 3-row header + 17 hourly time-slot rows block:

```
,"March 3, 2025",,,"March 4, 2025",,, ...      <- date header (one date per day-group)
,Monday,,,Tuesday,,, ...                          <- day name, as literally printed
,Operations,MOD,EA,Operations,MOD,EA, ...         <- role label, 3 columns per day
6:00-7:00 AM,Veronica,Veronica,-,Henry,,-, ...     <- one row per hourly slot, 6:00 AM–11:00 PM/12:00 AM
...
(blank separator row, then the next week repeats)
```

Column 0 is always the time-slot label. Confirmed via a full parse of the real export (not a sample): **1,835 CSV rows → 31,143 individual (date, time-slot, role, person) shift entries**, zero crashes, only 18 non-fatal warnings (all `DAY_NAME_MISMATCH`, all on the same one date where the sheet's own printed weekday doesn't match the calendar).

## Real data-quality findings — not silently normalized, all still exactly as found

- **24 distinct person-name tokens** appear in the sheet. Several are clear typo/spelling variants of what looks like the same person: `Henry`/`Heny`, `Michelle`/`Mcihelle`, `Catherine`/`Catheirne`, `Ken`/`Kenny`, and `Gracey`/`Garcey`/`Grace` (three variants). **None of these were merged** — each is its own distinct, unresolved identity, per the standing no-fuzzy-matching rule (see `team-identity-mapping.ts`). Confirming which of these are really the same person is a Kenny/Michelle question, not something this codebase should guess at.
- **Two different multi-person delimiters** are used inconsistently in the same tab: `/` (e.g. `Henry/Pam`) and `|` (e.g. `April | Mark | Nel`, three people in one cell). 1,852 cells (of 31,143) have more than one person. The parser (`sheet-schedule-parser.ts`) handles both.
- **Blank cell vs. explicit `-`**: both occur, inconsistently, and are NOT assumed to mean the same thing — the parser records `wasExplicitDash` on every cell so that distinction is never lost, even though both currently collapse to "no shift" for availability purposes.
- **Parenthetical annotations mixed into name cells** — e.g. `(project)`, `(Mark training)` — 215 occurrences. Preserved as a separate `note` field, never treated as a person name, never discarded.
- **Role-column label drift**: `"EA"` is the common case, but `"EA/Projects"` and `"EA/Project day"` both also appear for specific day-columns in specific weeks. Never normalized to one fixed label — the parser carries through exactly what was printed for that column.
- **Inconsistent date-cell formatting**: `"March 5,2025"` (no space after the comma) vs. `"March 5, 2025"` (with a space) both occur. The parser's date regex tolerates both.
- **Inconsistent time-slot label formatting**: `"6:00-7:00 AM"` (no spaces around the dash) vs. `"11:00 AM - 12:00 PM"` (spaces around the dash) vs. `"11:00 PM-12:00 AM"` (crosses midnight). The parser's time regex tolerates all three, and midnight-crossing is handled explicitly (adds 24h to the end instant) rather than producing an inverted/zero-length shift.
- **No email addresses, phone numbers, or other obviously-private data found anywhere in the sheet** — checked (a targeted scan for `@` and phone-number-shaped patterns across the entire export returned zero matches). The sheet appears to contain first names and shift assignments only.
- **No legend, key, or timezone indicator anywhere in the sheet** — checked (a targeted scan for "legend"/"key"/"notes"/"timezone"/timezone-name words returned zero matches). "MOD" and "EA" are never expanded or explained anywhere in the source. This codebase's own best guess — MOD = "Manager on Duty" (a standard hospitality term), EA = "Executive Assistant" (consistent with Michelle, a known StayWhile principal, appearing very frequently in that column) — is an **inference, not a confirmed fact**, and is not baked into any UI copy; the raw label is what gets displayed.

## Identity mapping status: everyone is UNMAPPED — confirmed, not assumed

Cross-checked every one of the 24 real sheet identities against the local dev database's actual `User` table (read-only query: `firstName`, `lastName`, `email`, `status` only). The database holds exactly 2 users — the seeded bootstrap admin and the developer's own test account — **neither matches any real schedule identity**. Every one of the 24 is therefore **UNMAPPED**; none is EXACTLY MAPPED, and none is AMBIGUOUS in the sense of matching multiple existing StayWhile users (there simply aren't any VA/team `User` records yet to be ambiguous against). `TEAM_IDENTITY_MAPPINGS` remains empty — populating it needs real StayWhile `User` accounts for these people to exist first, and then explicit, one-by-one human confirmation of each pairing (including resolving the typo-variant question above) — not something this pass did or should do unilaterally.

## What exists today (all local, real-structure-based where the real structure is now known)

- `services/csv.ts` — small RFC 4180 CSV parser (handles the real export's own quoted, comma-containing date cells). No CSV library existed in this monorepo; none was added.
- `services/timezone.ts` — `zonedTimeToUtc()`, a dependency-free, DST-aware wall-clock→UTC converter (uses the platform's built-in `Intl` timezone database). No date/timezone library existed in this monorepo; none was added. Every caller must supply an explicit IANA timezone — there is no default, because the real sheet doesn't state one (see below).
- `services/sheet-schedule-parser.ts` — `parseScheduleGrid()` (real CSV rows → structured `ScheduleSlot[]`, with non-fatal warnings for anything unparseable/inconsistent) and `toNormalizedShifts()` (bridges to `availability.ts`'s existing shape). Validated against the actual live export, not just synthetic fixtures (31,143 slots, 0 crashes) — though the committed automated test suite uses only synthetic fixtures with fake names, per instruction never to commit real schedule contents.
- `services/availability.ts` — pure `deriveAvailability()`/`isScheduleDataStale()`, unchanged from the original structure-agnostic design (the real data confirmed this design was already correct — nothing to revise).
- `services/team-identity-mapping.ts` — the same fail-closed, no-fuzzy-matching mapping pattern used elsewhere in this app, applied to people. Still deliberately empty (see above).
- `components/TeamAvailability.tsx` — presentational widget, unchanged from the original design (still correct against the real data shape).

**Not built, still correctly gated on a real decision or real accounts existing**: any populated identity mapping; any Prisma schema/migration for storing parsed schedule data or a sync log; any dashboard/route wiring (no route, no nav entry, not embedded in `DashboardSummary.tsx`); any RBAC resource/permission for schedule visibility; any actual scheduled/automatic refresh job (the parser can be run on demand today, but nothing calls it yet).

## Open questions this domain still cannot resolve on its own

1. **Timezone** — confirmed absent from the source itself; needs a direct answer from Michelle/Kenny (the smallest, single remaining blocking question — see `HANDOFF.md`'s Increment 97).
2. **Identity mapping** — which of the 24 real sheet identities correspond to which real person, including resolving the typo-variant pairs above, and creating real `User` accounts for them if they don't exist yet.
3. **Role-label meaning** — "MOD"/"EA"/"Operations" are inferred, not confirmed.
4. **Dashboard placement** — homepage widget vs. dedicated `/team` page vs. both; recommend deciding once there's mapped, real data to look at.
5. **RBAC** — which roles should see this at all; no "team lead"/scheduler role exists in the current catalog (`admin`/`ops_manager`/`cleaner`/`maintenance_tech`/`front_desk`/`read_only`).
6. **Refresh cadence** — how often to re-fetch the public CSV export; "don't hammer Google unnecessarily" suggests a modest interval (the export is a simple unauthenticated `GET`, not rate-limited by any known StayWhile-held API quota, but no official Google rate-limit research has been done for this specific unauthenticated-export mechanism, matching this codebase's own established practice of researching real limits per source rather than guessing).
