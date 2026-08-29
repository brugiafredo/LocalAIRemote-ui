import { AppError, ProviderOfflineError } from "../errors";
import { fetchWithTimeout, isRecord, numberValue, readJson, stringValue } from "../http";
import type { AIProvider, ChatChunk, ChatImage, ChatRequest, ChatToolCall, ModelCapability, ModelInfo, ProviderStatus } from "../types";

function modelsArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  return isRecord(payload) && Array.isArray(payload.models) ? payload.models : [];
}

function modelId(item: Record<string, unknown>): string | undefined {
  return stringValue(item.name) ?? stringValue(item.model);
}

function loadedIds(payload: unknown): Set<string> {
  return new Set(modelsArray(payload).flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const id = modelId(item);
    return id ? [id] : [];
  }));
}

function capabilitiesFromPayload(payload: unknown): ModelCapability[] {
  if (!isRecord(payload)) return [];
  const raw = payload.capabilities;
  if (!Array.isArray(raw)) return [];
  const capabilities: ModelCapability[] = [];
  for (const value of raw) {
    if (value === "vision") capabilities.push("vision");
    if (value === "tools" || value === "tool_use") capabilities.push("tools");
    if (value === "thinking" || value === "reasoning") capabilities.push("reasoning");
    if (value === "embedding") capabilities.push("embedding");
  }
  return [...new Set(capabilities)];
}

export function normalizeOllamaModels(installedPayload: unknown, runningPayload: unknown, capabilityPayloads: Record<string, unknown> = {}): ModelInfo[] {
  const running = loadedIds(runningPayload);
  return modelsArray(installedPayload).flatMap((item): ModelInfo[] => {
    if (!isRecord(item)) {
      return [];
    }
    const id = modelId(item);
    if (!id) {
      return [];
    }
    const details = isRecord(item.details) ? item.details : undefined;
    const model: ModelInfo = {
      provider: "ollama",
      id,
      name: stringValue(item.display_name) ?? (details ? stringValue(details.families) : undefined) ?? id,
      loaded: running.has(id),
      deletable: true,
    };
    const capabilities = capabilitiesFromPayload(capabilityPayloads[id]);
    if (capabilities.length > 0) model.capabilities = capabilities;
    const contextLength = numberValue(item.context_length) ?? numberValue(item.contextLength);
    const size = numberValue(item.size);
    if (contextLength !== undefined) {
      model.contextLength = contextLength;
    }
    if (size !== undefined) {
      model.size = size;
    }
    return [model];
  });
}

export function ollamaImageData(image: ChatImage): string {
  const comma = image.dataUrl.indexOf(",");
  return comma >= 0 ? image.dataUrl.slice(comma + 1) : image.dataUrl;
}

type OllamaMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  images?: string[] | undefined;
  tool_calls?: Array<{ function: { name: string; arguments: string } }> | undefined;
  tool_call_id?: string | undefined;
};

export function ollamaMessages(request: ChatRequest): OllamaMessage[] {
  const messages = request.messages.map((message): OllamaMessage => ({
    role: message.role,
    content: message.content,
    ...((message.images?.length ?? 0) > 0 ? { images: message.images?.map(ollamaImageData) } : {}),
    ...(message.toolCalls?.length ? {
      tool_calls: message.toolCalls.map((toolCall) => ({
        function: { name: toolCall.name, arguments: toolCall.arguments },
      })),
    } : {}),
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
  }));
  if (request.systemPrompt?.trim() && !messages.some((message) => message.role === "system")) {
    messages.unshift({ role: "system", content: request.systemPrompt.trim() });
  }
  return messages;
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function serializeToolArguments(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? {}) ?? "{}";
  } catch {
    return "{}";
  }
}

function toolCallsFromOllamaMessage(message: Record<string, unknown> | undefined): ChatToolCall[] {
  if (!message || !Array.isArray(message.tool_calls)) return [];
  return message.tool_calls.flatMap((value, index): ChatToolCall[] => {
    if (!isRecord(value)) return [];
    const fn = isRecord(value.function) ? value.function : value;
    const name = stringValue(fn.name);
    if (!name) return [];
    return [{
      id: stringValue(value.id) ?? `ollama-tool-${index + 1}`,
      name,
      arguments: serializeToolArguments(fn.arguments),
    }];
  });
}

async function* parseOllamaToolResponse(response: Response): AsyncIterable<ChatChunk> {
  const payload = await readJson(response);
  if (!isRecord(payload)) {
    throw new AppError("PROVIDER_ERROR", "Ollama returned an invalid tool response", 502);
  }
  const message = isRecord(payload.message) ? payload.message : undefined;
  const text = message ? textValue(message.content) : textValue(payload.response);
  const toolCalls = toolCallsFromOllamaMessage(message);
  if (text) yield { text };
  if (toolCalls.length > 0) yield { text: "", toolCalls };
  yield { text: "", done: true };
}

export async function* parseOllamaNdjson(response: Response): AsyncIterable<ChatChunk> {
  if (!response.body) {
    throw new AppError("PROVIDER_ERROR", "Ollama returned an empty stream", 502);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const result = await reader.read();
    if (result.done) {
      buffer += decoder.decode();
    } else {
      buffer += decoder.decode(result.value, { stream: true });
    }
    const lines = buffer.split(/\r?\n/);
    buffer = result.done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(line) as unknown;
      } catch {
        continue;
      }
      if (!isRecord(payload)) {
        continue;
      }
      const providerError = textValue(payload.error);
      if (providerError) {
        throw new AppError("PROVIDER_ERROR", providerError, 502);
      }
      const message = isRecord(payload.message) ? payload.message : undefined;
      const text = message
        ? textValue(message.content) ?? textValue(message.thinking)
        : textValue(payload.response) ?? textValue(payload.thinking);
      const done = payload.done === true;
      if (text || done) {
        yield { text: text ?? "", ...(done ? { done: true } : {}) };
      }
    }
    if (result.done) {
      break;
    }
  }
}

export class OllamaProvider implements AIProvider {
  readonly id = "ollama" as const;
  readonly name = "Ollama";
  private readonly baseUrl: string | null;

  constructor(baseUrl: string | null) {
    this.baseUrl = baseUrl;
  }

  private requireUrl(): string {
    if (!this.baseUrl) {
      throw new ProviderOfflineError(this.name);
    }
    return this.baseUrl;
  }

  async health(): Promise<ProviderStatus> {
    if (!this.baseUrl) {
      return { id: this.id, name: this.name, online: false, message: "OLLAMA_URL is not configured" };
    }
    try {
      const response = await fetchWithTimeout(`${this.baseUrl}/api/tags`, {}, 4_000);
      return response.ok
        ? { id: this.id, name: this.name, online: true }
        : { id: this.id, name: this.name, online: false, message: `Provider returned HTTP ${response.status}` };
    } catch {
      return { id: this.id, name: this.name, online: false, message: "Ollama is not reachable" };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const baseUrl = this.requireUrl();
    const [installedResponse, runningResponse] = await Promise.all([
      fetchWithTimeout(`${baseUrl}/api/tags`),
      fetchWithTimeout(`${baseUrl}/api/ps`),
    ]);
    const [installed, running] = await Promise.all([readJson(installedResponse), readJson(runningResponse)]);
    const capabilityPayloads: Record<string, unknown> = {};
    await Promise.all(modelsArray(installed).map(async (item) => {
      if (!isRecord(item)) return;
      const id = modelId(item);
      if (!id) return;
      try {
        const response = await fetchWithTimeout(`${baseUrl}/api/show`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: id }),
        }, 8_000);
        if (response.ok) capabilityPayloads[id] = await response.json();
      } catch {
        // Older Ollama versions may not expose model capabilities. The model
        // remains usable; the UI simply omits capability badges.
      }
    }));
    return normalizeOllamaModels(installed, running, capabilityPayloads);
  }

  async listLoadedModels(): Promise<ModelInfo[]> {
    const models = await this.listModels();
    return models.filter((model) => model.loaded);
  }

  async loadModel(model: string): Promise<void> {
    const baseUrl = this.requireUrl();
    const response = await fetchWithTimeout(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages: [], stream: false, keep_alive: -1 }),
    }, 120_000);
    await readJson(response);
  }

  async unloadModel(model: string): Promise<void> {
    const baseUrl = this.requireUrl();
    const response = await fetchWithTimeout(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages: [], stream: false, keep_alive: 0 }),
    }, 60_000);
    await readJson(response);
  }

  async downloadModel(model: string): Promise<void> {
    const baseUrl = this.requireUrl();
    const response = await fetchWithTimeout(`${baseUrl}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, stream: false }),
    }, 30 * 60_000);
    await readJson(response);
  }

  async deleteModel(model: string): Promise<void> {
    const baseUrl = this.requireUrl();
    const response = await fetchWithTimeout(`${baseUrl}/api/delete`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
    }, 120_000);
    await readJson(response);
  }

  async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
    const baseUrl = this.requireUrl();
    if (request.tools?.length) {
      const response = await fetchWithTimeout(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          model: request.model,
          messages: ollamaMessages(request),
          stream: false,
          think: false,
          tools: request.tools,
          keep_alive: -1,
          options: {
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
            ...(request.contextLength !== undefined ? { num_ctx: request.contextLength } : {}),
            ...(request.maxTokens !== undefined ? { num_predict: request.maxTokens } : {}),
          },
        }),
      }, 120_000);
      if (!response.ok) {
        await readJson(response);
      }
      yield* parseOllamaToolResponse(response);
      return;
    }
    const response = await fetchWithTimeout(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/x-ndjson" },
      body: JSON.stringify({
        model: request.model,
        messages: ollamaMessages(request),
        stream: true,
        // Do not spend the whole simple chat response budget on reasoning.
        think: false,
        keep_alive: -1,
        options: {
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.contextLength !== undefined ? { num_ctx: request.contextLength } : {}),
          ...(request.maxTokens !== undefined ? { num_predict: request.maxTokens } : {}),
        },
      }),
    }, 120_000);
    if (!response.ok) {
      await readJson(response);
    }
    yield* parseOllamaNdjson(response);
  }
}
