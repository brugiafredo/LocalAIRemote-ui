import { describe, expect, it } from "vitest";
import { LMStudioProvider, nativeInput, normalizeLMStudioModels } from "../src/providers/lmstudio";
import { normalizeOllamaModels, ollamaMessages, OllamaProvider, parseOllamaNdjson } from "../src/providers/ollama";

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

  it("normalizes vision, tool, and reasoning capabilities from LM Studio", () => {
    expect(normalizeLMStudioModels({ models: [{ key: "google/gemma-4", capabilities: { vision: true, trained_for_tool_use: true, reasoning: { allowed_options: ["on"] } } }] })).toEqual([
      { provider: "lmstudio", id: "google/gemma-4", name: "google/gemma-4", loaded: false, capabilities: ["vision", "tools", "reasoning"] },
    ]);
  });

  it("merges Ollama installed and running model lists", () => {
    const models = normalizeOllamaModels(
      { models: [{ name: "granite:latest", size: 1024 }] },
      { models: [{ name: "granite:latest" }] },
    );
    expect(models[0]).toMatchObject({ provider: "ollama", id: "granite:latest", loaded: true, size: 1024 });
  });

  it("normalizes Ollama capabilities returned by /api/show", () => {
    const models = normalizeOllamaModels(
      { models: [{ name: "gemma4", size: 1024 }] },
      { models: [] },
      { gemma4: { capabilities: ["completion", "vision", "thinking"] } },
    );
    expect(models[0]).toMatchObject({ capabilities: ["vision", "reasoning"] });
  });

  it("maps image data URLs to each provider's native image payload", () => {
    const request = {
      provider: "ollama" as const,
      model: "gemma4",
      messages: [{ role: "user" as const, content: "What is this?", images: [{ dataUrl: "data:image/png;base64,QUJD", mimeType: "image/png" as const }] }],
    };
    expect(ollamaMessages(request)).toEqual([{ role: "user", content: "What is this?", images: ["QUJD"] }]);
    expect(nativeInput({ ...request, provider: "lmstudio" })).toEqual([
      { type: "message", content: "User: What is this?" },
      { type: "image", data_url: "data:image/png;base64,QUJD" },
    ]);
  });

  it("parses Ollama content and thinking chunks and surfaces stream errors", async () => {
    const response = new Response([
      JSON.stringify({ message: { role: "assistant", thinking: "Let me think" }, done: false }),
      JSON.stringify({ message: { role: "assistant", content: "Hola" }, done: false }),
      JSON.stringify({ message: { role: "assistant", content: "" }, done: true }),
    ].join("\n"));
    const chunks: Array<{ text: string; done?: boolean }> = [];
    for await (const chunk of parseOllamaNdjson(response)) chunks.push(chunk);
    expect(chunks).toEqual([{ text: "Let me think" }, { text: "Hola" }, { text: "", done: true }]);

    await expect(async () => {
      for await (const _chunk of parseOllamaNdjson(new Response(JSON.stringify({ error: "model failed" })))) {
        // The iterator should reject before yielding a misleading empty answer.
      }
    }).rejects.toMatchObject({ code: "PROVIDER_ERROR", message: "model failed" });
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

  it("falls back to the OpenAI-compatible LM Studio chat endpoint after a 404", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    const bodies: string[] = [];
    globalThis.fetch = (async (input, init) => {
      urls.push(String(input));
      bodies.push(typeof init?.body === "string" ? init.body : "");
      if (urls.length === 1) {
        return new Response("not found", { status: 404 });
      }
      return new Response(
        'data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n' +
          'data: {"choices":[{"delta":{"content":" mundo"}}]}\n\n' +
          "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    }) as typeof fetch;

    try {
      const chunks = [];
      for await (const chunk of new LMStudioProvider("http://lmstudio.test").chat({
        provider: "lmstudio",
        model: "local/model",
        messages: [{
          role: "user",
          content: "Describe this",
          images: [{ dataUrl: "data:image/png;base64,QUJD", mimeType: "image/png" }],
        }],
        systemPrompt: "Be concise",
        temperature: 0.2,
        maxTokens: 128,
      })) {
        chunks.push(chunk);
      }

      expect(urls).toEqual([
        "http://lmstudio.test/api/v1/chat",
        "http://lmstudio.test/v1/chat/completions",
      ]);
      expect(JSON.parse(bodies[1])).toMatchObject({
        model: "local/model",
        stream: true,
        temperature: 0.2,
        max_tokens: 128,
        messages: [
          { role: "system", content: "Be concise" },
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this" },
              { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } },
            ],
          },
        ],
      });
      expect(chunks).toEqual([{ text: "Hola" }, { text: " mundo" }, { text: "", done: true }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
