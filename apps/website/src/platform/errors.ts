export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id: string) {
    super(`${entity} "${id}" not found.`, 404, "NOT_FOUND");
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, "VALIDATION_ERROR");
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "CONFLICT");
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string) {
    super(`${service}: ${message}`, 502, "EXTERNAL_SERVICE_ERROR");
  }
}

/** Thrown by getCurrentUser() when a resolved User row is DEACTIVATED (or soft-deleted) — blocks every route/action uniformly at the authentication boundary, before any assertPermission call runs. */
export class AccountDeactivatedError extends AppError {
  constructor() {
    super(
      "This account has been deactivated. Contact an administrator.",
      403,
      "ACCOUNT_DEACTIVATED",
    );
  }
}

/** Maps any thrown error to a safe {data, error} JSON envelope. Never leaks raw Prisma/internal errors to clients. */
export function toErrorResponse(err: unknown): {
  status: number;
  body: { data: null; error: { code: string; message: string } };
} {
  if (err instanceof AppError) {
    return {
      status: err.statusCode,
      body: { data: null, error: { code: err.code, message: err.message } },
    };
  }
  if (
    err &&
    typeof err === "object" &&
    "name" in err &&
    err.name === "ForbiddenError"
  ) {
    return {
      status: 403,
      body: {
        data: null,
        error: { code: "FORBIDDEN", message: (err as Error).message },
      },
    };
  }
  console.error("Unhandled error:", err);
  return {
    status: 500,
    body: {
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
    },
  };
}
