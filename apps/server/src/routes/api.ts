import type { FastifyInstance, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { asAppError, AppError } from "../errors";
import { ChatRequestSchema, ModelActionSchema } from "../schemas";
import { SystemService } from "../services/system";
import type { ChatChunk } from "../types";
import { ProviderRegistry } from "../providers/registry";

function sendError(reply: FastifyReply, error: unknown): void {
  if (reply.sent) {
    return;
  }
  if (error instanceof ZodError) {
    reply.status(400).send({ error: true, code: "VALIDATION_ERROR", message: "Request validation failed", details: error.issues });
    return;
  }
  const appError = asAppError(error);
  reply.status(appError.statusCode).send({ error: true, code: appError.code, message: appError.message });
}

function writeSse(reply: FastifyReply, event: string, payload: ChatChunk | { error: true; code: string; message: string }): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export function registerApiRoutes(app: FastifyInstance, registry: ProviderRegistry, systemService: SystemService): void {
  app.get("/api/health", async (_request, reply) => {
    try {
      const statuses = await registry.statuses();
      reply.send({
        status: "ok",
        providers: Object.fromEntries(statuses.map((status) => [status.id, { online: status.online, ...(status.message ? { message: status.message } : {}) }])),
      });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get("/api/providers", async (_request, reply) => {
    try {
      reply.send(await registry.statuses());
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get("/api/models", async (_request, reply) => {
    try {
      reply.send(await registry.models());
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/models/load", async (request, reply) => {
    try {
      const body = ModelActionSchema.parse(request.body);
      await registry.get(body.provider).loadModel(body.model, body.contextLength);
      reply.send({ ok: true, provider: body.provider, model: body.model, loaded: true });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/models/unload", async (request, reply) => {
    try {
      const body = ModelActionSchema.parse(request.body);
      await registry.get(body.provider).unloadModel(body.model);
      reply.send({ ok: true, provider: body.provider, model: body.model, loaded: false });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/chat", async (request, reply) => {
    let body;
    try {
      body = ChatRequestSchema.parse(request.body);
    } catch (error) {
      sendError(reply, error);
      return;
    }
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    try {
      const stream = registry.get(body.provider).chat(body);
      for await (const chunk of stream) {
        writeSse(reply, chunk.done ? "done" : "chunk", chunk);
      }
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    } catch (error) {
      const appError = asAppError(error);
      if (!reply.raw.writableEnded) {
        writeSse(reply, "error", { error: true, code: appError.code, message: appError.message });
        reply.raw.end();
      }
    }
  });

  app.get("/api/system", async (_request, reply) => {
    try {
      reply.send(await systemService.snapshot());
    } catch (error) {
      const appError = error instanceof AppError ? error : new AppError("SYSTEM_INFO_UNAVAILABLE", "System information is unavailable", 503);
      sendError(reply, appError);
    }
  });
}
