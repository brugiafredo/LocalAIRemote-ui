import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api, ApiError } from "../services/api";
import type { ModelInfo, ProviderId, ProviderStatus } from "../types";
import { useUiStore } from "./ui";

export const useAppStore = defineStore("app", () => {
  const providers = ref<ProviderStatus[]>([
    { id: "lmstudio", name: "LM Studio", online: false },
    { id: "ollama", name: "Ollama", online: false },
  ]);
  const models = ref<ModelInfo[]>([]);
  const loadingModels = ref(false);
  const actionKey = ref<string | null>(null);
  const selectedKey = ref<string | null>(localStorage.getItem("local-ai-selected-model"));

  const selectedModel = computed(() => models.value.find((model) => `${model.provider}:${model.id}` === selectedKey.value) ?? null);
  const onlineProviders = computed(() => providers.value.filter((provider) => provider.online));

  function modelKey(model: Pick<ModelInfo, "provider" | "id">): string {
    return `${model.provider}:${model.id}`;
  }
  function selectModel(model: ModelInfo): void {
    selectedKey.value = modelKey(model);
    localStorage.setItem("local-ai-selected-model", selectedKey.value);
  }
  function provider(providerId: ProviderId): ProviderStatus {
    return providers.value.find((item) => item.id === providerId) ?? { id: providerId, name: providerId, online: false };
  }
  async function refresh(): Promise<void> {
    loadingModels.value = true;
    try {
      const [nextProviders, nextModels] = await Promise.all([api.providers(), api.models()]);
      providers.value = nextProviders;
      models.value = nextModels;
      if (!selectedModel.value && nextModels.length > 0) {
        const loaded = nextModels.find((model) => model.loaded) ?? nextModels[0];
        if (loaded) {
          selectModel(loaded);
        }
      }
    } catch (error) {
      const ui = useUiStore();
      ui.showToast(error instanceof ApiError ? error.message : "Unable to refresh providers", "error");
    } finally {
      loadingModels.value = false;
    }
  }
  async function load(model: ModelInfo, contextLength?: number): Promise<void> {
    const ui = useUiStore();
    actionKey.value = modelKey(model);
    try {
      await api.loadModel(model.provider, model.id, contextLength);
      await refresh();
      const refreshed = models.value.find((item) => modelKey(item) === modelKey(model));
      if (refreshed) {
        selectModel(refreshed);
      }
      ui.showToast(`${model.name} loaded`, "success");
    } catch (error) {
      ui.showToast(error instanceof ApiError ? error.message : "Unable to load model", "error");
    } finally {
      actionKey.value = null;
    }
  }
  async function unload(model: ModelInfo): Promise<void> {
    const ui = useUiStore();
    actionKey.value = modelKey(model);
    try {
      await api.unloadModel(model.provider, model.id);
      await refresh();
      ui.showToast(`${model.name} unloaded`, "success");
    } catch (error) {
      ui.showToast(error instanceof ApiError ? error.message : "Unable to unload model", "error");
    } finally {
      actionKey.value = null;
    }
  }
  function isBusy(model: ModelInfo): boolean {
    return actionKey.value === modelKey(model);
  }

  return { providers, models, loadingModels, actionKey, selectedModel, onlineProviders, modelKey, selectModel, provider, refresh, load, unload, isBusy };
});
