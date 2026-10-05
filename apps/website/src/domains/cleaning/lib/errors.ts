/**
 * An expected, user-fixable refusal from the cleaning domain (inactive
 * cleaner, job already completed/cancelled, not allowed to change the
 * cleaner, …). Its message is written by us for the person using the
 * dashboard, so actions.ts may show it as-is — unlike a Prisma/DB error,
 * whose message never reaches the browser. Same convention as the cleaners
 * domain's CleanerRuleError.
 */
export class CleaningRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CleaningRuleError";
  }
}
