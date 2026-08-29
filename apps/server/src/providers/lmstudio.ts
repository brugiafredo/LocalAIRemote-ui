import { AppError, ProviderOfflineError } from "../errors";
import { fetchWithTimeout, isRecord, numberValue, readJson, stringValue } from "../http";
import type { AIProvider, ChatChunk, ChatRequest, ModelInfo, ProviderStatus } from "../types";

interface InternalModel extends ModelInfo {
  instanceId?: string;
}

function arrayFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!isRecord(payload)) {
    return [];
  }
  const candidates = [payload.models, payload.data, payload.results];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

function nestedArray(record: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function firstInstanceId(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstInstanceId(item);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  if (isRecord(value)) {
    return stringValue(value.instance_id) ?? stringValue(value.instanceId) ?? stringValue(value.id);
  }
  return undefined;
}

function hasLoadedState(record: Record<string, unknown>, instances: unknown[]): boolean {
  if (instances.length > 0) {
    return true;
  }
  if (record.loaded === true || record.is_loaded === true) {
    return true;
  }
  const state = stringValue(record.state)?.toLowerCase();
  return state === "loaded" || state === "ready" || state === "running";
}

export function normalizeLMStudioModels(payload: unknown): InternalModel[] {
  return arrayFromPayload(payload).flatMap((item): InternalModel[] => {
    if (!isRecord(item)) {
      return [];
    }
    // LM Studio v1 calls the stable model identifier `key`; older versions used id/model_key.
    const id = stringValue(item.key) ?? stringValue(item.id) ?? stringValue(item.model_key) ?? stringValue(item.model);
    if (!id) {
      return [];
    }
    const instances = nestedArray(item, ["loaded_instances", "loadedInstances", "instances"]);
    const instanceId = firstInstanceId(instances) ?? stringValue(item.instance_id) ?? stringValue(item.instanceId);
    const model: InternalModel = {
      provider: "lmstudio",
      id,
      name: stringValue(item.display_name) ?? stringValue(item.name) ?? id,
      loaded: hasLoadedState(item, instances),
    };
    const contextLength = numberValue(item.context_length) ?? numberValue(item.max_context_length);
    const size = numberValue(item.size) ?? numberValue(item.size_bytes);
    if (contextLength !== undefined) {
      model.contextLength = contextLength;
    }
    if (size !== undefined) {
      model.size = size;
    }
    if (instanceId) {
      model.instanceId = instanceId;
    }
    return [model];
  });
}

function nativeInput(request: ChatRequest): string {
  return request.messages
    .filter((message) => message.role !== "system")
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
    .join("\n\n");
}

function textFromEvent(value: unknown, eventName: string): string | undefined {
  if (typeof value === "string") {
    return eventName.includes("message") || eventName.includes("delta") ? value : undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const direct = [value.text, value.content, value.response];
  for (const candidate of direct) {
    if (typeof candidate === "string") {
      return candidate;
    }
  }
  const delta = value.delta;
  if (isRecord(delta)) {
    return stringValue(delta.content) ?? stringValue(delta.text);
  }
  const message = value.message;
  if (isRecord(message)) {
    return stringValue(message.content) ?? stringValue(message.text);
  }
  const choices = value.choices;
  if (Array.isArray(choices)) {
    const first = choices[0];
    if (isRecord(first)) {
      const choiceDelta = first.delta;
      if (isRecord(choiceDelta)) {
        return stringValue(choiceDelta.content) ?? stringValue(choiceDelta.text);
      }
      const choiceMessage = first.message;
      if (isRecord(choiceMessage)) {
        return stringValue(choiceMessage.content);
      }
    }
  }
  return undefined;
}

async function* parseNamedSse(response: Response): AsyncIterable<ChatChunk> {
  if (!response.body) {
    throw new AppError("PROVIDER_ERROR", "LM Studio returned an empty stream", 502);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let dataLines: string[] = [];

  const dispatch = (): ChatChunk | undefined => {
    if (dataLines.length === 0) {
      eventName = "message";
      return undefined;
    }
    const raw = dataLines.join("\n");
    dataLines = [];
    const currentEvent = eventName;
    eventName = "message";
    if (raw === "[DONE]") {
      return { text: "", done: true };
    }
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return raw ? { text: raw } : undefined;
    }
    const text = textFromEvent(parsed, currentEvent);
    const done = currentEvent.includes("end") || currentEvent.includes("complete") || (isRecord(parsed) && parsed.done === true);
    if (text || done) {
      return { text: text ?? "", ...(done ? { done: true } : {}) };
    }
    return undefined;
  };

  while (true) {
    const result = await reader.read();
    if (result.done) {
      buffer += decoder.decode();
      break;
    }
    buffer += decoder.decode(result.value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line === "") {
        const chunk = dispatch();
        if (chunk) {
          yield chunk;
        }
      } else if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
  }
  if (buffer.startsWith("data:")) {
    dataLines.push(buffer.slice(5).trimStart());
  }
  const finalChunk = dispatch();
  if (finalChunk) {
    yield finalChunk;
  }
}

export class LMStudioProvider implements AIProvider {
  readonly id = "lmstudio" as const;
  readonly name = "LM Studio";
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
      return { id: this.id, name: this.name, online: false, message: "LM_STUDIO_URL is not configured" };
    }
    try {
      let response = await fetchWithTimeout(`${this.baseUrl}/api/v1/models`, {}, 4_000);
      if (response.status === 404) {
        response = await fetchWithTimeout(`${this.baseUrl}/api/v0/models`, {}, 4_000);
      }
      if (!response.ok) {
        return { id: this.id, name: this.name, online: false, message: `Provider returned HTTP ${response.status}` };
      }
      return { id: this.id, name: this.name, online: true };
    } catch {
      return { id: this.id, name: this.name, online: false, message: "LM Studio is not reachable" };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const baseUrl = this.requireUrl();
    let response = await fetchWithTimeout(`${baseUrl}/api/v1/models`);
    if (response.status === 404) {
      response = await fetchWithTimeout(`${baseUrl}/api/v0/models`);
    }
    const payload = await readJson(response);
    return normalizeLMStudioModels(payload);
  }

  async listLoadedModels(): Promise<ModelInfo[]> {
    const models = await this.listModels();
    return models.filter((model) => model.loaded);
  }

  async loadModel(model: string, contextLength?: number): Promise<void> {
    const baseUrl = this.requireUrl();
    const body: Record<string, unknown> = { model };
    if (contextLength !== undefined) {
      body.context_length = contextLength;
    }
    const response = await fetchWithTimeout(`${baseUrl}/api/v1/models/load`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }, 120_000);
    await readJson(response);
  }

  async unloadModel(model: string): Promise<void> {
    const baseUrl = this.requireUrl();
    const models = await this.listModels() as InternalModel[];
    const loaded = models.find((candidate) => candidate.id === model && candidate.loaded);
    if (!loaded) {
      throw new AppError("MODEL_NOT_LOADED", `${model} is not loaded in LM Studio`, 409);
    }
    if (!loaded.instanceId) {
      throw new AppError("PROVIDER_ERROR", "LM Studio did not report an instance id for the loaded model", 502);
    }
    const response = await fetchWithTimeout(`${baseUrl}/api/v1/models/unload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instance_id: loaded.instanceId }),
    }, 120_000);
    await readJson(response);
  }

  async downloadModel(_model: string): Promise<void> {
    throw new AppError("MODEL_ACTION_UNSUPPORTED", "LM Studio model downloads are managed by the LM Studio application", 405);
  }

  async deleteModel(_model: string): Promise<void> {
    throw new AppError("MODEL_ACTION_UNSUPPORTED", "LM Studio model deletion is managed by the LM Studio application", 405);
  }

  async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
    const baseUrl = this.requireUrl();
    const body: Record<string, unknown> = {
      model: request.model,
      input: nativeInput(request),
      stream: true,
    };
    if (request.systemPrompt?.trim()) {
      body.system_prompt = request.systemPrompt.trim();
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      body.max_output_tokens = request.maxTokens;
    }
    const response = await fetchWithTimeout(`${baseUrl}/api/v1/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(body),
    }, 120_000);
    if (!response.ok) {
      await readJson(response);
    }
    yield* parseNamedSse(response);
  }
}
