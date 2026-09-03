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
  dataDir: string;
  authEnabled: boolean;
  authPassword: string | null;
  updateEnabled: boolean;
  updateToken: string | null;
  updateBranch: string;
  opencodeBridgeEnabled: boolean;
  opencodeBridgeToken: string | null;
  projectRoot: string;
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

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawEnvironment = env.NODE_ENV;
  const nodeEnv: AppConfig["nodeEnv"] = rawEnvironment === "development" || rawEnvironment === "test" ? rawEnvironment : "production";
  const configuredOrigins = env.CORS_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean);

  const projectRoot = path.resolve(process.cwd());
  return {
    port: positiveInteger(env.PORT, 3000),
    host: env.HOST?.trim() || "0.0.0.0",
    appName: env.APP_NAME?.trim() || "Escarlet Local AI UI",
    nodeEnv,
    lmStudioUrl: optionalUrl(env.LM_STUDIO_URL),
    ollamaUrl: optionalUrl(env.OLLAMA_URL),
    corsOrigins: configuredOrigins && configuredOrigins.length > 0 ? configuredOrigins : true,
    dataDir: path.resolve(env.DATA_DIR?.trim() || path.join(projectRoot, "data")),
    authEnabled: booleanValue(env.AUTH_ENABLED, false),
    authPassword: env.AUTH_PASSWORD?.trim() || null,
    updateEnabled: booleanValue(env.UPDATE_ENABLED, false),
    updateToken: env.UPDATE_TOKEN?.trim() || null,
    updateBranch: env.UPDATE_BRANCH?.trim() || "master",
    opencodeBridgeEnabled: booleanValue(env.OPENCODE_BRIDGE_ENABLED, false),
    opencodeBridgeToken: env.OPENCODE_BRIDGE_TOKEN?.trim() || null,
    projectRoot,
  };
}
