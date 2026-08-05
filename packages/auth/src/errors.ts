export class ForbiddenError extends Error {
  constructor(permissionKey: string, propertyId?: string) {
    super(
      propertyId
        ? `Missing permission "${permissionKey}" for property "${propertyId}".`
        : `Missing permission "${permissionKey}".`,
    );
    this.name = "ForbiddenError";
  }
}
