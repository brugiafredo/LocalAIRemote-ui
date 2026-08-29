import { AppError, ProviderOfflineError } from "../errors";
import { fetchWithTimeout, isRecord, numberValue, readJson, stringValue } from "../http";
import type { AIProvider, ChatChunk, ChatRequest, ModelInfo, ProviderStatus } from "../types";

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

export function normalizeOllamaModels(installedPayload: unknown, runningPayload: unknown): ModelInfo[] {
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

function ollamaMessages(request: ChatRequest): Array<{ role: "user" | "assistant" | "system"; content: string }> {
  const messages = request.messages.map((message) => ({ role: message.role, content: message.content }));
  if (request.systemPrompt?.trim() && !messages.some((message) => message.role === "system")) {
    messages.unshift({ role: "system", content: request.systemPrompt.trim() });
  }
  return messages;
}

async function* parseNdjson(response: Response): AsyncIterable<ChatChunk> {
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
      const message = isRecord(payload.message) ? payload.message : undefined;
      const text = message ? stringValue(message.content) : stringValue(payload.response);
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
    return normalizeOllamaModels(installed, running);
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
    const response = await fetchWithTimeout(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/x-ndjson" },
      body: JSON.stringify({
        model: request.model,
        messages: ollamaMessages(request),
        stream: true,
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
    yield* parseNdjson(response);
  }
}
