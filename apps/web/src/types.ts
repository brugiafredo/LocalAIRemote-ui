export type ProviderId = "lmstudio" | "ollama";

export interface ModelInfo {
  provider: ProviderId;
  id: string;
  name: string;
  loaded: boolean;
  contextLength?: number;
  size?: number;
}

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  online: boolean;
  message?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ConversationParameters {
  temperature: number;
  maxTokens: number;
  contextLength: number;
}

export interface Conversation {
  id: string;
  title: string;
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  systemPrompt: string;
  parameters: ConversationParameters;
  createdAt: string;
  updatedAt: string;
}

export interface ChatRequest {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  contextLength?: number;
}

export interface ChatStreamChunk {
  text: string;
  done?: boolean;
}

export interface SystemInfo {
  cpu: { usagePercent: number | null; cores: number | null };
  memory: { usedBytes: number | null; totalBytes: number | null; usagePercent: number | null };
  gpu: Array<{ name: string; memoryUsedBytes: number | null; memoryTotalBytes: number | null; usagePercent: number | null }>;
  operatingSystem: string;
  uptimeSeconds: number | null;
  capturedAt: string;
}

export interface ApiErrorShape {
  error: true;
  code: string;
  message: string;
}
