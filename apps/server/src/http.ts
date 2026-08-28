import { ProviderHttpError, ProviderOfflineError } from "./errors";

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    throw new ProviderOfflineError("Provider");
  } finally {
    clearTimeout(timeout);
  }
}

export async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    let detail = "Provider request failed";
    try {
      const body: unknown = await response.json();
      if (isRecord(body) && typeof body.error === "string") {
        detail = body.error;
      }
    } catch {
      // The provider returned a non-JSON error; keep the safe generic message.
    }
    throw new ProviderHttpError(detail, response.status);
  }
  return response.json() as Promise<unknown>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
