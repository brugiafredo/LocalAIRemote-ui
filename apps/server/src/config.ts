import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

export interface AppConfig {
  port: number;
  host: string;
  appName: string;
  nodeEnv: "development" | "test" | "production";
  lmStudioUrl: string | null;
  ollamaUrl: string | null;
  corsOrigins: true | string[];
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/$/, "") : null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawEnvironment = env.NODE_ENV;
  const nodeEnv: AppConfig["nodeEnv"] = rawEnvironment === "development" || rawEnvironment === "test" ? rawEnvironment : "production";
  const configuredOrigins = env.CORS_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean);

  return {
    port: positiveInteger(env.PORT, 3000),
    host: env.HOST?.trim() || "0.0.0.0",
    appName: env.APP_NAME?.trim() || "Local AI",
    nodeEnv,
    lmStudioUrl: optionalUrl(env.LM_STUDIO_URL),
    ollamaUrl: optionalUrl(env.OLLAMA_URL),
    corsOrigins: configuredOrigins && configuredOrigins.length > 0 ? configuredOrigins : true,
  };
}
