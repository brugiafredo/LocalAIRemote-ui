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
  lastRequest: ChatRequest | undefined;
  constructor(private readonly online: boolean) {}
  async health(): Promise<ProviderStatus> { return { id: this.id, name: this.name, online: this.online }; }
  async listModels(): Promise<ModelInfo[]> { return this.online ? [{ provider: this.id, id: "test-model", name: "Test Model", loaded: true }] : []; }
  async listLoadedModels(): Promise<ModelInfo[]> { return this.listModels(); }
  async loadModel(_model: string): Promise<void> {}
  async unloadModel(_model: string): Promise<void> {}
  async *chat(request: ChatRequest): AsyncIterable<ChatChunk> { this.lastRequest = request; yield { text: "hello" }; yield { text: "", done: true }; }
}

class TruncatedStreamProvider extends TestProvider {
  override async *chat(_request: ChatRequest): AsyncIterable<ChatChunk> { yield { text: "hello" }; }
}

class FixedSystemService extends SystemService {
  override async snapshot(): Promise<SystemInfo> {
    return { cpu: { usagePercent: 12, cores: 8 }, memory: { usedBytes: 2, totalBytes: 4, usagePercent: 50 }, gpu: [], operatingSystem: "Test OS", uptimeSeconds: 10, capturedAt: new Date(0).toISOString() };
  }
}

const config: AppConfig = { port: 3000, host: "127.0.0.1", appName: "Test", nodeEnv: "test", lmStudioUrl: null, ollamaUrl: null, corsOrigins: true, dataDir: "/tmp/local-ai-test", authEnabled: false, authPassword: null, updateEnabled: false, updateToken: null, updateBranch: "master", opencodeBridgeEnabled: false, opencodeBridgeToken: null, projectRoot: process.cwd() };
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

  it("exposes the running Git identity", async () => {
    app = await buildApp(config, new ProviderRegistry([new TestProvider(true)]), new FixedSystemService());
    const response = await app.inject({ method: "GET", url: "/api/version" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      shortCommit: expect.stringMatching(/^(unknown|[0-9a-f]{7})$/),
      commit: expect.any(String),
      buildCommit: expect.stringMatching(/^(unknown|[0-9a-f]{7,40})$/),
      buildShortCommit: expect.stringMatching(/^(unknown|[0-9a-f]{7})$/),
      runningCommit: expect.stringMatching(/^(unknown|[0-9a-f]{7,40})$/),
      runningShortCommit: expect.stringMatching(/^(unknown|[0-9a-f]{7})$/),
      bootId: expect.any(String),
      branch: expect.any(String),
      startedAt: expect.any(String),
    });
  });

  it("requires update authorization for a manual service restart", async () => {
    app = await buildApp({ ...config, updateEnabled: true, updateToken: "update-secret" }, new ProviderRegistry([new TestProvider(true)]), new FixedSystemService());
    const unauthorized = await app.inject({ method: "POST", url: "/api/service/restart", payload: {} });
    expect(unauthorized.statusCode).toBe(401);
    const response = await app.inject({ method: "POST", url: "/api/service/restart", payload: { token: "update-secret" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ state: "restart-required", currentVersion: expect.any(String) });
  });
});

describe("OpenCode bridge", () => {
  const bridgeConfig = { ...config, opencodeBridgeEnabled: true, opencodeBridgeToken: "bridge-secret" };

  it("is disabled by default", async () => {
    app = await buildApp(config, new ProviderRegistry([new TestProvider(true)]), new FixedSystemService());
    const response = await app.inject({ method: "GET", url: "/v1/models" });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "BRIDGE_DISABLED" } });
  });

  it("lists prefixed models and streams OpenAI-compatible completions", async () => {
    app = await buildApp(bridgeConfig, new ProviderRegistry([new TestProvider(true)]), new FixedSystemService());
    const unauthorized = await app.inject({ method: "GET", url: "/v1/models" });
    expect(unauthorized.statusCode).toBe(401);
    const models = await app.inject({ method: "GET", url: "/v1/models", headers: { authorization: "Bearer bridge-secret" } });
    expect(models.statusCode).toBe(200);
    expect(models.json()).toMatchObject({ object: "list", data: [{ id: "active", object: "model", owned_by: "local-ai" }, { id: "lmstudio/test-model", object: "model", owned_by: "lmstudio" }] });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer bridge-secret" },
      payload: { model: "lmstudio/test-model", messages: [{ role: "user", content: "hello" }], stream: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).toContain('"content":"hello"');
    expect(response.body).toContain("data: [DONE]");

    const selected = await app.inject({ method: "POST", url: "/api/bridge/active", payload: { provider: "lmstudio", model: "test-model" } });
    expect(selected.statusCode).toBe(200);
    const activeResponse = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer bridge-secret" },
      payload: { model: "active", messages: [{ role: "user", content: "hello" }], stream: false },
    });
    expect(activeResponse.statusCode).toBe(200);
    expect(activeResponse.json()).toMatchObject({ model: "active", choices: [{ message: { content: "hello" } }] });
  });

  it("converts multimodal messages and supports non-stream responses", async () => {
    const provider = new TestProvider(true);
    app = await buildApp(bridgeConfig, new ProviderRegistry([provider]), new FixedSystemService());
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer bridge-secret" },
      payload: {
        model: "lmstudio/test-model",
        messages: [
          { role: "system", content: "Be concise" },
          { role: "user", content: [{ type: "text", text: "What is this?" }, { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }] },
        ],
        stream: false,
        temperature: 0.2,
        max_completion_tokens: 128,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ object: "chat.completion", choices: [{ message: { role: "assistant", content: "hello" } }] });
    expect(provider.lastRequest).toMatchObject({
      model: "test-model",
      systemPrompt: "Be concise",
      temperature: 0.2,
      maxTokens: 128,
      messages: [{ role: "user", content: "What is this?", images: [{ dataUrl: "data:image/png;base64,QUJD", mimeType: "image/png" }] }],
    });
  });

  it("rejects unprefixed or unknown model ids", async () => {
    app = await buildApp(bridgeConfig, new ProviderRegistry([new TestProvider(true)]), new FixedSystemService());
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer bridge-secret" },
      payload: { model: "test-model", messages: [{ role: "user", content: "hello" }] },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "MODEL_NOT_FOUND" } });
  });
});
