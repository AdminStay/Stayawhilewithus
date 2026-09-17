import { Badge } from "@stayw/ui";

/**
 * Admin-only diagnostic — the caller gates this on team:manage (see
 * /team's page.tsx) before ever fetching `identities`, so an ordinary
 * viewer never even causes this list to be computed, let alone rendered.
 * Names the real, unresolved typo-variant clusters (Henry/Heny, etc. — see
 * README.md) rather than hiding the data-quality problem, since fixing it
 * requires a human to actually see it.
 */
export function UnresolvedIdentities({ identities }: { identities: string[] }) {
  if (identities.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Every source identity currently on the schedule is linked to a StayWhile
        login.
      </p>
    );
  }

  return (
    <div>
      <p className="text-sm text-ink-muted">
        {identities.length} source identit
        {identities.length === 1 ? "y is" : "ies are"} not yet linked to a
        StayWhile login. Spelling/typo variants of the same real person (if any)
        are listed separately here and are never auto-merged — see this domain's
        README.md.
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {identities.map((name) => (
          <li key={name}>
            <Badge tone="neutral">{name}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
