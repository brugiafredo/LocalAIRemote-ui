import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { ProviderRegistry } from "../src/providers/registry";
import type { AIProvider, ChatChunk, ChatRequest, ModelInfo, ProviderStatus, SystemInfo } from "../src/types";
import type { AppConfig } from "../src/config";
import { SystemService } from "../src/services/system";

class TestProvider implements AIProvider {
  readonly id = "lmstudio" as const;
  readonly name = "LM Studio";
  constructor(private readonly online: boolean) {}
  async health(): Promise<ProviderStatus> { return { id: this.id, name: this.name, online: this.online }; }
  async listModels(): Promise<ModelInfo[]> { return this.online ? [{ provider: this.id, id: "test-model", name: "Test Model", loaded: true }] : []; }
  async listLoadedModels(): Promise<ModelInfo[]> { return this.listModels(); }
  async loadModel(_model: string): Promise<void> {}
  async unloadModel(_model: string): Promise<void> {}
  async *chat(_request: ChatRequest): AsyncIterable<ChatChunk> { yield { text: "hello" }; yield { text: "", done: true }; }
}

class TruncatedStreamProvider extends TestProvider {
  override async *chat(_request: ChatRequest): AsyncIterable<ChatChunk> { yield { text: "hello" }; }
}

class FixedSystemService extends SystemService {
  override async snapshot(): Promise<SystemInfo> {
    return { cpu: { usagePercent: 12, cores: 8 }, memory: { usedBytes: 2, totalBytes: 4, usagePercent: 50 }, gpu: [], operatingSystem: "Test OS", uptimeSeconds: 10, capturedAt: new Date(0).toISOString() };
  }
}

const config: AppConfig = { port: 3000, host: "127.0.0.1", appName: "Test", nodeEnv: "test", lmStudioUrl: null, ollamaUrl: null, corsOrigins: true };
let app: FastifyInstance | undefined;

afterEach(async () => { await app?.close(); app = undefined; });

describe("unified API", () => {
  it("returns discovered models while tolerating an offline provider", async () => {
    app = await buildApp(config, new ProviderRegistry([new TestProvider(true)]), new FixedSystemService());
    const response = await app.inject({ method: "GET", url: "/api/models" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{ provider: "lmstudio", id: "test-model", name: "Test Model", loaded: true }]);
  });

  it("returns a coherent health status", async () => {
    app = await buildApp(config, new ProviderRegistry([new TestProvider(false)]), new FixedSystemService());
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", providers: { lmstudio: { online: false } } });
  });

  it("rejects malformed model actions with the public error envelope", async () => {
    app = await buildApp(config, new ProviderRegistry([new TestProvider(true)]), new FixedSystemService());
    const response = await app.inject({ method: "POST", url: "/api/models/load", payload: { provider: "unknown", model: "" } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: true, code: "VALIDATION_ERROR" });
  });

  it("closes a provider stream with a terminal event when the provider omits done", async () => {
    app = await buildApp(config, new ProviderRegistry([new TruncatedStreamProvider(true)]), new FixedSystemService());
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { provider: "lmstudio", model: "test-model", messages: [{ role: "user", content: "hello" }] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("event: chunk");
    expect(response.body).toContain('data: {"text":"hello"}');
    expect(response.body).toContain("event: done");
  });
});
