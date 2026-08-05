// Deliberately duplicated from @stayw/integrations' NotImplementedError rather
// than shared: @stayw/ai must not depend on @stayw/integrations (see ADR-0007
// on provider-agnosticism), and this class is tiny enough that a cross-package
// dependency isn't worth the coupling.
export class NotImplementedError extends Error {
  constructor(component: string, method: string) {
    super(`${component}: "${method}" is not implemented yet.`);
    this.name = "NotImplementedError";
  }
}
