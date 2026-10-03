/**
 * An expected, user-fixable refusal from the cleaners domain (inactive
 * cleaner, non-operational property, already assigned, …). Its message is
 * written by us for the person using the dashboard, so actions.ts may show
 * it as-is — unlike a Prisma/DB error, whose message never reaches the
 * browser.
 */
export class CleanerRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CleanerRuleError";
  }
}
