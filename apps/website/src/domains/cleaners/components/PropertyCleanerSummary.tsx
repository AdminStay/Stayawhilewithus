import type { PropertyCleanerSummary as Summary } from "../services/cleaner-assignments.service";

/** The Properties list's "Cleaner" cell — names only, never a phone number. */
export function PropertyCleanerSummary({
  summary,
}: {
  summary: Summary | undefined;
}) {
  if (!summary || (!summary.primary && summary.teamMembers.length === 0)) {
    return <span className="text-ink-faint">No cleaner</span>;
  }
  if (!summary.primary) {
    return (
      <span className="text-ink-muted">
        Team: {summary.teamMembers.join(", ")}{" "}
        <span className="text-xs text-warning-700">(primary not set)</span>
      </span>
    );
  }
  return (
    <span className="text-ink">
      {summary.primary}
      {summary.teamMembers.length > 0 && (
        <span className="text-ink-muted">
          {" "}
          + {summary.teamMembers.join(", ")}
        </span>
      )}
    </span>
  );
}
