export class NotImplementedError extends Error {
  constructor(provider: string, method: string) {
    super(`${provider}: "${method}" is not implemented yet.`);
    this.name = "NotImplementedError";
  }
}
