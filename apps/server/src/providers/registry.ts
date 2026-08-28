import { AppError } from "../errors";
import { LMStudioProvider } from "./lmstudio";
import { OllamaProvider } from "./ollama";
import type { AIProvider, ModelInfo, ProviderId, ProviderStatus } from "../types";
import type { AppConfig } from "../config";

export class ProviderRegistry {
  private readonly providers: Map<ProviderId, AIProvider>;

  constructor(providers: AIProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
  }

  get(providerId: ProviderId): AIProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new AppError("VALIDATION_ERROR", `Unknown provider: ${providerId}`, 400);
    }
    return provider;
  }

  all(): AIProvider[] {
    return [...this.providers.values()];
  }

  async statuses(): Promise<ProviderStatus[]> {
    return Promise.all(this.all().map(async (provider) => provider.health()));
  }

  async models(): Promise<ModelInfo[]> {
    const results = await Promise.allSettled(this.all().map((provider) => provider.listModels()));
    return results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  }
}

export function createProviderRegistry(config: AppConfig): ProviderRegistry {
  return new ProviderRegistry([
    new LMStudioProvider(config.lmStudioUrl),
    new OllamaProvider(config.ollamaUrl),
  ]);
}
