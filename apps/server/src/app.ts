import path from "node:path";
import fs from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import type { AppConfig } from "./config";
import { registerApiRoutes } from "./routes/api";
import { ProviderRegistry } from "./providers/registry";
import { SystemService } from "./services/system";

export async function buildApp(
  config: AppConfig,
  registry: ProviderRegistry,
  systemService = new SystemService(),
): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.nodeEnv === "development" });
  await app.register(cors, {
    origin: config.corsOrigins,
  });
  registerApiRoutes(app, registry, systemService);

  const webDistCandidates = [
    path.resolve(process.cwd(), "apps/web/dist"),
    path.resolve(__dirname, "../../web/dist"),
  ];
  const webDist = webDistCandidates.find((candidate) => fs.existsSync(candidate));
  if (config.nodeEnv === "production" && webDist) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        reply.status(404).send({ error: true, code: "NOT_FOUND", message: "Route not found" });
        return;
      }
      reply.sendFile("index.html");
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (reply.sent) {
      return;
    }
    reply.status(500).send({ error: true, code: "INTERNAL_ERROR", message: "An unexpected server error occurred" });
  });
  return app;
}
