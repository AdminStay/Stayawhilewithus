export class InvalidActionStateError extends Error {
  constructor(actionId: string, actualStatus: string, expectedStatus: string) {
    super(
      `AiAction "${actionId}" is ${actualStatus}, expected ${expectedStatus}.`,
    );
    this.name = "InvalidActionStateError";
  }
}
