import { describe, expect, it } from "vitest";
import { LMStudioProvider, normalizeLMStudioModels } from "../src/providers/lmstudio";
import { normalizeOllamaModels, OllamaProvider } from "../src/providers/ollama";

describe("provider model normalization", () => {
  it("normalizes LM Studio v1 metadata and loaded instances", () => {
    const models = normalizeLMStudioModels({
      models: [{
        id: "local/model",
        display_name: "Local Model",
        loaded_instances: [{ instance_id: "instance-1" }],
        context_length: 8192,
      }],
    });
    expect(models).toEqual([{ provider: "lmstudio", id: "local/model", name: "Local Model", loaded: true, contextLength: 8192, instanceId: "instance-1" }]);
  });

  it("supports the current LM Studio v1 key field", () => {
    expect(normalizeLMStudioModels({ models: [{ key: "qwen/qwen3.5-27b", display_name: "Qwen 3.5 27B" }] })).toEqual([
      { provider: "lmstudio", id: "qwen/qwen3.5-27b", name: "Qwen 3.5 27B", loaded: false },
    ]);
  });

  it("merges Ollama installed and running model lists", () => {
    const models = normalizeOllamaModels(
      { models: [{ name: "granite:latest", size: 1024 }] },
      { models: [{ name: "granite:latest" }] },
    );
    expect(models[0]).toMatchObject({ provider: "ollama", id: "granite:latest", loaded: true, size: 1024 });
  });
});

describe("offline provider handling", () => {
  it("reports an unconfigured LM Studio as offline without throwing from health", async () => {
    const status = await new LMStudioProvider(null).health();
    expect(status.online).toBe(false);
    await expect(new LMStudioProvider(null).listModels()).rejects.toMatchObject({ code: "PROVIDER_OFFLINE" });
  });

  it("reports an unconfigured Ollama as offline", async () => {
    const status = await new OllamaProvider(null).health();
    expect(status).toMatchObject({ id: "ollama", online: false });
  });
});
