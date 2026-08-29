export type ErrorCode =
  | "VALIDATION_ERROR"
  | "PROVIDER_OFFLINE"
  | "PROVIDER_HTTP_ERROR"
  | "MODEL_NOT_FOUND"
  | "MODEL_NOT_LOADED"
  | "PROVIDER_ERROR"
  | "SYSTEM_INFO_UNAVAILABLE"
  | "MODEL_ACTION_UNSUPPORTED"
  | "AUTH_REQUIRED"
  | "INVALID_CREDENTIALS"
  | "UPDATE_DISABLED"
  | "UPDATE_IN_PROGRESS"
  | "UPDATE_FAILED"
  | "BRIDGE_DISABLED"
  | "BRIDGE_MISCONFIGURED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, statusCode = 500) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class ProviderHttpError extends AppError {
  constructor(message: string, statusCode: number) {
    super("PROVIDER_HTTP_ERROR", message, statusCode >= 400 && statusCode < 500 ? 502 : 503);
    this.name = "ProviderHttpError";
  }
}

export class ProviderOfflineError extends AppError {
  constructor(providerName: string) {
    super("PROVIDER_OFFLINE", `${providerName} is not available`, 503);
    this.name = "ProviderOfflineError";
  }
}

export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new AppError("PROVIDER_OFFLINE", "The provider request timed out", 504);
  }
  return new AppError("INTERNAL_ERROR", "An unexpected server error occurred", 500);
}
