export type ProviderId = "lmstudio" | "ollama";

export interface ModelInfo {
  provider: ProviderId;
  id: string;
  name: string;
  loaded: boolean;
  contextLength?: number;
  size?: number;
  deletable?: boolean;
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

export interface ChatRequest {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  systemPrompt?: string | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  contextLength?: number | undefined;
}

export interface ChatChunk {
  text: string;
  done?: boolean;
}

export interface AIProvider {
  readonly id: ProviderId;
  readonly name: string;
  health(): Promise<ProviderStatus>;
  listModels(): Promise<ModelInfo[]>;
  listLoadedModels(): Promise<ModelInfo[]>;
  loadModel(model: string, contextLength?: number): Promise<void>;
  unloadModel(model: string): Promise<void>;
  downloadModel?(model: string): Promise<void>;
  deleteModel?(model: string): Promise<void>;
  chat(request: ChatRequest): AsyncIterable<ChatChunk>;
}

export interface Conversation {
  id: string;
  title: string;
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  systemPrompt: string;
  parameters: { temperature: number; maxTokens: number; contextLength: number };
  createdAt: string;
  updatedAt: string;
  ownerId?: string;
  visibility?: "private" | "shared";
  sharedWith?: string[];
}

export interface SystemInfo {
  cpu: {
    usagePercent: number | null;
    cores: number | null;
  };
  memory: {
    usedBytes: number | null;
    totalBytes: number | null;
    usagePercent: number | null;
  };
  gpu: Array<{
    name: string;
    memoryUsedBytes: number | null;
    memoryTotalBytes: number | null;
    usagePercent: number | null;
  }>;
  operatingSystem: string;
  uptimeSeconds: number | null;
  capturedAt: string;
}
