import { randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config";
import { AppError, asAppError } from "../errors";
import { ProviderRegistry } from "../providers/registry";
import { BridgeService } from "../services/bridge";
import type { ChatImage, ChatMessage, ChatRequest, ChatToolCall, ModelInfo, ProviderId } from "../types";

const MAX_MESSAGE_TEXT_CHARS = 200_000;
const MAX_TOTAL_TEXT_CHARS = 512_000;

const OpenAITextPartSchema = z.object({
  type: z.literal("text"),
  text: z.string().max(MAX_MESSAGE_TEXT_CHARS),
});

const OpenAIImagePartSchema = z.object({
  type: z.literal("image_url"),
  image_url: z.object({ url: z.string().max(6_000_000) }).passthrough(),
});

const OpenAIToolCallSchema = z.object({
  id: z.string().trim().min(1).max(500),
  type: z.literal("function"),
  function: z.object({
    name: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
    arguments: z.string().max(MAX_MESSAGE_TEXT_CHARS),
  }),
});

const OpenAIMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.union([
    z.string().max(MAX_MESSAGE_TEXT_CHARS),
    z.array(z.union([OpenAITextPartSchema, OpenAIImagePartSchema])).max(8),
  ]).nullable(),
  tool_calls: z.array(OpenAIToolCallSchema).max(64).optional(),
  tool_call_id: z.string().trim().min(1).max(500).optional(),
}).superRefine((message, context) => {
  if (message.role === "tool" && !message.tool_call_id) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["tool_call_id"], message: "Tool messages require tool_call_id" });
  }
  if (message.role === "tool" && typeof message.content !== "string") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["content"], message: "Tool message content must be text" });
  }
  if (message.tool_calls?.length && message.role !== "assistant") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["tool_calls"], message: "Only assistant messages may contain tool_calls" });
  }
});

const OpenAIToolDefinitionSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
    description: z.string().max(16_000).optional(),
    parameters: z.record(z.unknown()).optional().default({}),
  }),
});

const OpenAIToolChoiceSchema = z.union([
  z.enum(["none", "auto", "required"]),
  z.object({
    type: z.literal("function"),
    function: z.object({ name: z.string().trim().min(1).max(64) }),
  }),
]);

const OpenAIChatRequestSchema = z.object({
  model: z.string().trim().min(1).max(1_000),
  messages: z.array(OpenAIMessageSchema).min(1).max(200),
  stream: z.boolean().optional().default(true),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().max(1_000_000).optional(),
  max_completion_tokens: z.number().int().positive().max(1_000_000).optional(),
  tools: z.array(OpenAIToolDefinitionSchema).max(64).optional(),
  tool_choice: OpenAIToolChoiceSchema.optional().default("auto"),
}).passthrough().superRefine((request, context) => {
  const totalTextChars = request.messages.reduce((total, message) => {
    const contentChars = typeof message.content === "string"
      ? message.content.length
      : (message.content ?? []).reduce((sum, part) => sum + (part.type === "text" ? part.text.length : 0), 0);
    const toolArgumentChars = (message.tool_calls ?? []).reduce((sum, call) => sum + call.function.arguments.length, 0);
    return total + contentChars + toolArgumentChars;
  }, 0);
  if (totalTextChars > MAX_TOTAL_TEXT_CHARS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["messages"],
      message: `Combined message text must not exceed ${MAX_TOTAL_TEXT_CHARS} characters`,
    });
  }
});

type OpenAIChatRequest = z.infer<typeof OpenAIChatRequestSchema>;

interface ConvertedMessage {
  role: ChatMessage["role"];
  content: string;
  images?: ChatImage[] | undefined;
  toolCalls?: ChatToolCall[] | undefined;
  toolCallId?: string | undefined;
}

interface ParsedModel {
  provider: ProviderId;
  model: string;
}

type ModelSelection = ParsedModel | { alias: "active" };

function sendError(reply: FastifyReply, error: unknown): void {
  const appError = error instanceof z.ZodError
    ? new AppError("VALIDATION_ERROR", "Request validation failed", 400)
    : asAppError(error);
  reply.status(appError.statusCode).send({
    error: {
      message: appError.message,
      type: appError.code === "AUTH_REQUIRED" ? "authentication_error" : "invalid_request_error",
      code: appError.code,
    },
  });
}

function bridgeEnabled(config: AppConfig): void {
  if (!config.opencodeBridgeEnabled) {
    throw new AppError("BRIDGE_DISABLED", "The OpenCode bridge is disabled in .env", 403);
  }
  if (!config.opencodeBridgeToken) {
    throw new AppError("BRIDGE_MISCONFIGURED", "OPENCODE_BRIDGE_TOKEN must be configured when the bridge is enabled", 503);
  }
}

function authorized(request: FastifyRequest, config: AppConfig): void {
  bridgeEnabled(config);
  const header = request.headers.authorization;
  const supplied = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const expected = config.opencodeBridgeToken ?? "";
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    throw new AppError("AUTH_REQUIRED", "A valid OpenCode bridge bearer token is required", 401);
  }
}

function parseModelId(value: string): ModelSelection {
  if (value === "active") return { alias: "active" };
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) {
    throw new AppError("MODEL_NOT_FOUND", "Model ids must use provider/model format", 404);
  }
  const provider = value.slice(0, separator);
  const model = value.slice(separator + 1);
  if (provider !== "ollama" && provider !== "lmstudio") {
    throw new AppError("MODEL_NOT_FOUND", `Unknown model provider: ${provider}`, 404);
  }
  return { provider, model };
}

function imageFromDataUrl(value: string): ChatImage {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) {
    throw new AppError("VALIDATION_ERROR", "The OpenCode bridge only accepts base64 JPEG, PNG, or WebP data URLs", 400);
  }
  const encoded = match[2];
  if (!encoded) {
    throw new AppError("VALIDATION_ERROR", "The image data URL is empty", 400);
  }
  const decodedBytes = Math.floor(encoded.length * 3 / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if (decodedBytes > 4_000_000) {
    throw new AppError("VALIDATION_ERROR", "Each image must be 4 MB or smaller", 400);
  }
  return { dataUrl: value, mimeType: match[1] as ChatImage["mimeType"], size: decodedBytes };
}

function convertMessages(messages: OpenAIChatRequest["messages"]): { messages: ConvertedMessage[]; systemPrompt?: string | undefined } {
  const converted = messages.map((message): ConvertedMessage => {
    const parts = typeof message.content === "string" || message.content === null
      ? [{ text: message.content ?? "" }]
      : message.content.map((part) => part.type === "text"
        ? { text: part.text }
        : { image: imageFromDataUrl(part.image_url.url) });
    const content = parts.flatMap((part) => "text" in part ? [part.text] : []).join("\n");
    const images = parts.flatMap((part) => "image" in part ? [part.image] : []);
    if (images.length > 2) {
      throw new AppError("VALIDATION_ERROR", "You can attach up to 2 images per message", 400);
    }
    const toolCalls = message.tool_calls?.map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    }));
    return {
      role: message.role,
      content,
      ...(images.length > 0 ? { images } : {}),
      ...(toolCalls?.length ? { toolCalls } : {}),
      ...(message.tool_call_id ? { toolCallId: message.tool_call_id } : {}),
    };
  });
  const systemPrompt = converted.filter((message) => message.role === "system").map((message) => message.content.trim()).filter(Boolean).join("\n\n");
  return {
    messages: converted.filter((message) => message.role !== "system"),
    ...(systemPrompt ? { systemPrompt } : {}),
  };
}

async function availableModel(registry: ProviderRegistry, bridge: BridgeService, selection: ModelSelection): Promise<ModelInfo> {
  const models = await registry.models();
  const isActive = "alias" in selection;
  const active = isActive ? await bridge.getActive() : null;
  const found = active
    ? models.find((model) => model.provider === active.provider && model.id === active.model) ?? models.find((model) => model.loaded) ?? models[0]
    : isActive
      ? models.find((model) => model.loaded) ?? models[0]
      : models.find((model) => model.provider === selection.provider && model.id === selection.model);
  if (!found) {
    throw new AppError("MODEL_NOT_FOUND", isActive ? "No local model is available for the active bridge model" : `Model is not available: ${selection.provider}/${selection.model}`, 404);
  }
  return found;
}

function modelId(model: ModelInfo): string {
  return `${model.provider}/${model.id}`;
}

function openAIModel(model: ModelInfo): Record<string, unknown> {
  return {
    id: modelId(model),
    object: "model",
    created: 0,
    owned_by: model.provider,
    ...(model.capabilities ? { capabilities: model.capabilities } : {}),
    ...(model.contextLength ? { context_length: model.contextLength } : {}),
  };
}

function writeEvent(reply: FastifyReply, payload: unknown): void {
  reply.raw.write(`data: ${payload === "[DONE]" ? "[DONE]" : JSON.stringify(payload)}\n\n`);
}

function completionChunk(id: string, model: string, text: string, finishReason: string | null = null): Record<string, unknown> {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1_000),
    model,
    choices: [{ index: 0, delta: text ? { content: text } : {}, finish_reason: finishReason }],
  };
}

function openAIToolCalls(toolCalls: ChatToolCall[]): Array<Record<string, unknown>> {
  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    type: "function",
    function: { name: toolCall.name, arguments: toolCall.arguments },
  }));
}

function toolCallChunk(id: string, model: string, toolCalls: ChatToolCall[]): Record<string, unknown> {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1_000),
    model,
    choices: [{
      index: 0,
      delta: {
        tool_calls: openAIToolCalls(toolCalls).map((toolCall, index) => ({ index, ...toolCall })),
      },
      finish_reason: null,
    }],
  };
}

function chatRequest(body: OpenAIChatRequest, parsed: ParsedModel, model: ModelInfo): ChatRequest {
  const converted = convertMessages(body.messages);
  if (converted.messages.length === 0) {
    throw new AppError("VALIDATION_ERROR", "At least one non-system message is required", 400);
  }
  const useTools = Boolean(body.tools?.length) && body.tool_choice !== "none";
  if (useTools && !model.capabilities?.includes("tools")) {
    throw new AppError("VALIDATION_ERROR", `Model ${model.provider}/${model.id} does not advertise tool support`, 400);
  }
  return {
    provider: parsed.provider,
    model: parsed.model,
    messages: converted.messages,
    ...(converted.systemPrompt ? { systemPrompt: converted.systemPrompt } : {}),
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...((body.max_completion_tokens ?? body.max_tokens) !== undefined ? { maxTokens: body.max_completion_tokens ?? body.max_tokens } : {}),
    ...(useTools ? {
      tools: body.tools?.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.function.name,
          description: tool.function.description ?? "",
          parameters: tool.function.parameters,
        },
      })),
      enableTools: true,
    } : {}),
  };
}

export function registerOpenCodeBridgeRoutes(app: FastifyInstance, config: AppConfig, registry: ProviderRegistry, bridge: BridgeService): void {
  app.get("/v1/models", async (request, reply) => {
    try {
      authorized(request, config);
      const models = await registry.models();
      reply.send({ object: "list", data: [{ id: "active", object: "model", created: 0, owned_by: "local-ai" }, ...models.map(openAIModel)] });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/v1/chat/completions", async (request, reply) => {
    let body: OpenAIChatRequest;
    let parsed: ModelSelection;
    let model: ModelInfo;
    let providerRequest: ChatRequest;
    try {
      authorized(request, config);
      body = OpenAIChatRequestSchema.parse(request.body);
      parsed = parseModelId(body.model);
      model = await availableModel(registry, bridge, parsed);
      providerRequest = chatRequest(body, { provider: model.provider, model: model.id }, model);
    } catch (error) {
      sendError(reply, error);
      return;
    }

    const id = `chatcmpl-${randomUUID()}`;
    if (body.stream === false) {
      try {
        let content = "";
        const toolCalls: ChatToolCall[] = [];
        for await (const chunk of registry.get(model.provider).chat(providerRequest)) {
          content += chunk.text;
          if (chunk.toolCalls?.length) toolCalls.push(...chunk.toolCalls);
        }
        reply.send({
          id,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1_000),
          model: body.model,
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: content || (toolCalls.length > 0 ? null : ""),
              ...(toolCalls.length > 0 ? { tool_calls: openAIToolCalls(toolCalls) } : {}),
            },
            finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
          }],
        });
      } catch (error) {
        sendError(reply, error);
      }
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
      let emittedToolCalls = false;
      for await (const chunk of registry.get(model.provider).chat(providerRequest)) {
        if (chunk.text) writeEvent(reply, completionChunk(id, body.model, chunk.text));
        if (chunk.toolCalls?.length) {
          emittedToolCalls = true;
          writeEvent(reply, toolCallChunk(id, body.model, chunk.toolCalls));
        }
      }
      writeEvent(reply, completionChunk(id, body.model, "", emittedToolCalls ? "tool_calls" : "stop"));
      writeEvent(reply, "[DONE]");
    } catch (error) {
      const appError = asAppError(error);
      writeEvent(reply, { error: { message: appError.message, type: "provider_error", code: appError.code } });
      writeEvent(reply, "[DONE]");
    } finally {
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  });
}
