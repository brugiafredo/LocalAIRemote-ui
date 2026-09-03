import { AppError } from "../errors";
import { ProviderRegistry } from "../providers/registry";
import { SystemService } from "./system";
import type { ChatChunk, ChatMessage, ChatRequest, ChatToolCall, ChatToolDefinition } from "../types";

/**
 * Tools exposed to local models are deliberately read-only. The model cannot
 * choose an arbitrary command, URL, file, or program to execute.
 */
export const LOCAL_TOOL_DEFINITIONS: ChatToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_system_info",
      description: "Get a read-only snapshot of this Escarlet Local AI UI server's CPU, memory, GPU, operating system, and uptime.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_local_models",
      description: "List the models currently known by the configured local providers and whether each one is loaded.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_provider_status",
      description: "Check whether the configured Ollama and LM Studio provider APIs are reachable.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

interface LocalToolDependencies {
  registry: ProviderRegistry;
  systemService: SystemService;
}

function result(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

function parseArguments(rawArguments: string): Record<string, unknown> {
  if (!rawArguments.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(rawArguments);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function executeLocalTool(name: string, rawArguments: string, dependencies: LocalToolDependencies): Promise<string> {
  // Parse even for no-argument tools so malformed model output is handled as a
  // harmless empty argument object instead of becoming executable input.
  parseArguments(rawArguments);
  try {
    switch (name) {
      case "get_system_info":
        return result({ ok: true, data: await dependencies.systemService.snapshot() });
      case "list_local_models":
        return result({ ok: true, data: await dependencies.registry.models() });
      case "get_provider_status":
        return result({ ok: true, data: await dependencies.registry.statuses() });
      default:
        return result({ ok: false, error: `Tool is not available: ${name}` });
    }
  } catch (error) {
    return result({ ok: false, error: error instanceof Error && error.message ? error.message : "The local tool failed" });
  }
}

export async function* chatWithLocalTools(
  provider: { chat(request: ChatRequest): AsyncIterable<ChatChunk> },
  request: ChatRequest,
  dependencies: LocalToolDependencies,
): AsyncIterable<ChatChunk> {
  const messages: ChatMessage[] = request.messages.slice();
  const maxToolRounds = 3;

  for (let round = 0; round < maxToolRounds; round += 1) {
    const toolCalls: ChatToolCall[] = [];
    let assistantText = "";
    for await (const chunk of provider.chat({ ...request, messages, tools: LOCAL_TOOL_DEFINITIONS })) {
      if (chunk.text) {
        assistantText += chunk.text;
        yield { text: chunk.text };
      }
      if (chunk.toolCalls?.length) {
        toolCalls.push(...chunk.toolCalls);
      }
    }

    if (toolCalls.length === 0) {
      yield { text: "", done: true };
      return;
    }
    if (round === maxToolRounds - 1) {
      throw new AppError("PROVIDER_ERROR", "The model reached the local tool-call limit before returning a final answer", 502);
    }

    messages.push({ role: "assistant", content: assistantText, toolCalls });
    for (const toolCall of toolCalls) {
      const toolResult = await executeLocalTool(toolCall.name, toolCall.arguments, dependencies);
      messages.push({ role: "tool", content: toolResult, toolCallId: toolCall.id });
    }
  }
}
