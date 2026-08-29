import type { FastifyInstance, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { asAppError, AppError } from "../errors";
import { AuthLoginSchema, ChatRequestSchema, ConversationSchema, ModelActionSchema, UpdateTokenSchema } from "../schemas";
import { SystemService } from "../services/system";
import type { ChatChunk, Conversation } from "../types";
import { ProviderRegistry } from "../providers/registry";
import { AuthService } from "../services/auth";
import { ConversationStore } from "../services/conversations";
import { UpdateService } from "../services/update";

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

export function registerApiRoutes(app: FastifyInstance, registry: ProviderRegistry, systemService: SystemService, auth: AuthService, conversations: ConversationStore, updates: UpdateService): void {
  app.get("/api/auth/status", async (request, reply) => reply.send(auth.status(request)));

  app.post("/api/auth/login", async (request, reply) => {
    try {
      const body = AuthLoginSchema.parse(request.body);
      const user = auth.login(body.password, reply);
      reply.send({ enabled: auth.enabled, authenticated: true, user });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/auth/logout", async (request, reply) => {
    auth.logout(request, reply);
    reply.status(204).send();
  });

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
      auth.requireUser(request);
      const body = ModelActionSchema.parse(request.body);
      await registry.get(body.provider).loadModel(body.model, body.contextLength);
      reply.send({ ok: true, provider: body.provider, model: body.model, loaded: true });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/models/unload", async (request, reply) => {
    try {
      auth.requireUser(request);
      const body = ModelActionSchema.parse(request.body);
      await registry.get(body.provider).unloadModel(body.model);
      reply.send({ ok: true, provider: body.provider, model: body.model, loaded: false });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/models/download", async (request, reply) => {
    try {
      auth.requireUser(request);
      const body = ModelActionSchema.parse(request.body);
      const provider = registry.get(body.provider);
      if (!provider.downloadModel) throw new AppError("MODEL_ACTION_UNSUPPORTED", "This provider does not support model downloads", 405);
      await provider.downloadModel(body.model);
      reply.send({ ok: true, provider: body.provider, model: body.model });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/models/delete", async (request, reply) => {
    try {
      auth.requireUser(request);
      const body = ModelActionSchema.parse(request.body);
      const provider = registry.get(body.provider);
      if (!provider.deleteModel) throw new AppError("MODEL_ACTION_UNSUPPORTED", "This provider does not support model deletion", 405);
      await provider.deleteModel(body.model);
      reply.send({ ok: true, provider: body.provider, model: body.model, deleted: true });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/chat", async (request, reply) => {
    let body;
    try {
      auth.requireUser(request);
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

  app.get("/api/conversations", async (request, reply) => {
    try {
      const user = auth.requireUser(request);
      reply.send(await conversations.listFor(user.id));
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/conversations", async (request, reply) => {
    try {
      const user = auth.requireUser(request);
      const body = ConversationSchema.parse(request.body);
      reply.send(await conversations.save(user.id, body as Conversation));
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.delete("/api/conversations/:id", async (request, reply) => {
    try {
      const user = auth.requireUser(request);
      const params = request.params as { id?: string };
      if (!params.id) throw new AppError("VALIDATION_ERROR", "Conversation id is required", 400);
      await conversations.remove(user.id, params.id);
      reply.status(204).send();
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get("/api/update/status", async (_request, reply) => {
    try {
      reply.send(await updates.status());
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/update/check", async (request, reply) => {
    try {
      const body = UpdateTokenSchema.parse(request.body ?? {});
      const user = auth.userFor(request);
      updates.authorize(body.token, Boolean(user));
      reply.send(await updates.check());
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/update", async (request, reply) => {
    try {
      const body = UpdateTokenSchema.parse(request.body ?? {});
      const user = auth.userFor(request);
      updates.authorize(body.token, Boolean(user));
      reply.send(await updates.update());
    } catch (error) {
      sendError(reply, error);
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
