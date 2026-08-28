import { loadConfig } from "./config";
import { buildApp } from "./app";
import { createProviderRegistry } from "./providers/registry";

async function start(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp(config, createProviderRegistry(config));
  await app.listen({ port: config.port, host: config.host });
}

void start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unable to start server";
  console.error(message);
  process.exitCode = 1;
});
