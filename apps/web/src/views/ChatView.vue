<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { api, ApiError } from "../services/api";
import { useAppStore } from "../stores/app";
import { useConversationStore } from "../stores/conversations";
import { useUiStore } from "../stores/ui";
import type { ChatMessage, ModelInfo } from "../types";
import ChatComposer from "../components/ChatComposer.vue";
import ConversationSettings from "../components/ConversationSettings.vue";
import MessageBubble from "../components/MessageBubble.vue";
import ModelCapabilities from "../components/ModelCapabilities.vue";
import ModelSelector from "../components/ModelSelector.vue";

const app = useAppStore();
const conversations = useConversationStore();
const ui = useUiStore();
const messageList = ref<HTMLElement | null>(null);
const streaming = ref(false);
const loading = ref(false);
const modelModalOpen = ref(false);
const settingsModalOpen = ref(false);
const composerHidden = ref(false);
const toolsEnabled = ref(false);
const backgroundedDuringRequest = ref(false);
let recoveryTimer: ReturnType<typeof setTimeout> | undefined;

const conversation = computed(() => conversations.activeConversation);
const selectedModel = computed(() => {
  if (!conversation.value) return app.selectedModel;
  return app.models.find((model) => model.provider === conversation.value?.provider && model.id === conversation.value?.model) ?? app.selectedModel;
});
const selectedProvider = computed(() => selectedModel.value ? app.provider(selectedModel.value.provider) : null);
const connection = computed(() => {
  if (!app.serverOnline) {
    return { tone: "offline", label: "Escarlet Local AI UI server offline", detail: "The browser cannot reach the Escarlet Local AI UI service." };
  }
  if (!selectedProvider.value) {
    return { tone: "offline", label: "No provider selected", detail: "Choose a model to connect to a local provider." };
  }
  if (!selectedProvider.value.online) {
    return { tone: "offline", label: `${selectedProvider.value.name} offline`, detail: selectedProvider.value.message || `${selectedProvider.value.name} API server is unreachable.` };
  }
  return { tone: "online", label: `${selectedProvider.value.name} online`, detail: selectedProvider.value.message || "Provider API is reachable." };
});
const statusMessage = computed(() => {
  if (!selectedModel.value) return "Choose a model to begin";
  if (!app.serverOnline) return "Escarlet Local AI UI server offline";
  if (!selectedProvider.value?.online) return `${selectedModel.value.name} · provider offline`;
  if (!selectedModel.value.loaded && selectedModel.value.provider === "lmstudio") return `${selectedModel.value.name} · auto-loads on first message`;
  if (!selectedModel.value.loaded) return `${selectedModel.value.name} · load before chatting`;
  return `${selectedModel.value.name} · ready`;
});
const composerDisabled = computed(() => loading.value || !selectedModel.value || !app.serverOnline || !selectedProvider.value?.online || (selectedModel.value.provider === "ollama" && !selectedModel.value.loaded));
const toolsAvailable = computed(() => Boolean(selectedModel.value?.capabilities?.includes("tools")));

watch(() => conversations.activeId, () => void nextTick(scrollToBottom));
watch(() => conversation.value?.messages.length, () => void nextTick(scrollToBottom));
watch(() => [selectedModel.value?.provider, selectedModel.value?.id], () => { toolsEnabled.value = false; });

function scheduleRemoteRecovery(): void {
  void conversations.hydrateRemote();
  if (recoveryTimer !== undefined) clearTimeout(recoveryTimer);
  recoveryTimer = setTimeout(() => {
    recoveryTimer = undefined;
    void conversations.hydrateRemote();
  }, 1_200);
}

function handleVisibilityChange(): void {
  if (document.visibilityState === "hidden") {
    if (loading.value) backgroundedDuringRequest.value = true;
    return;
  }
  if (backgroundedDuringRequest.value) scheduleRemoteRecovery();
}

onMounted(() => document.addEventListener("visibilitychange", handleVisibilityChange));
onUnmounted(() => {
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  if (recoveryTimer !== undefined) clearTimeout(recoveryTimer);
});

function scrollToBottom(): void {
  if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight;
}
function selectModel(model: ModelInfo): void {
  app.selectModel(model);
  void api.setBridgeActive(model.provider, model.id).catch(() => undefined);
  void app.refresh();
  if (conversation.value) conversations.updateConversation(conversation.value.id, { provider: model.provider, model: model.id });
}
function loadSelectedModel(): void {
  const model = selectedModel.value;
  if (model) {
    void app.load(model, conversation.value?.parameters.contextLength);
  }
}
function updateSettings(patch: Partial<Pick<NonNullable<typeof conversation.value>, "systemPrompt" | "parameters">>): void {
  if (conversation.value) conversations.updateConversation(conversation.value.id, patch);
}
async function retryConnection(): Promise<void> {
  await app.refresh();
}
function toggleTools(): void {
  if (!toolsAvailable.value) return;
  toolsEnabled.value = !toolsEnabled.value;
  ui.showToast(toolsEnabled.value ? "Safe read-only local tools enabled" : "Local tools disabled", "info");
}
async function sendMessage(payload: { content: string; images: NonNullable<ChatMessage["images"]> }): Promise<void> {
  const model = selectedModel.value;
  if (!model) {
    ui.showToast("Select a model first", "info");
    return;
  }
  if (!model.loaded && model.provider !== "lmstudio") {
    ui.showToast("Load this model before starting a chat", "info");
    return;
  }
  if (!conversation.value) return;
  if (payload.images.length > 0 && !model.capabilities?.includes("vision")) {
    ui.showToast("This model does not report image support", "info");
    return;
  }
  const active = conversation.value;
  backgroundedDuringRequest.value = false;
  const userMessage: ChatMessage = { role: "user", content: payload.content, ...(payload.images.length > 0 ? { images: payload.images } : {}) };
  conversations.addMessage(active.id, userMessage);
  conversations.addMessage(active.id, { role: "assistant", content: "" });
  streaming.value = true;
  loading.value = true;
  await nextTick(scrollToBottom);
  try {
    const requestMessages = active.messages.slice(0, -1).filter((message) => message.role !== "system");
    const request = {
      provider: model.provider,
      model: model.id,
      conversationId: active.id,
      messages: requestMessages,
      ...(active.systemPrompt.trim() ? { systemPrompt: active.systemPrompt } : {}),
      temperature: active.parameters.temperature,
      maxTokens: active.parameters.maxTokens,
      contextLength: active.parameters.contextLength,
      ...(toolsAvailable.value ? { enableTools: toolsEnabled.value } : {}),
    };
    let contentSoFar = "";
    for await (const chunk of api.chat(request)) {
      contentSoFar += chunk.text;
      conversations.updateLastAssistant(active.id, contentSoFar);
      await nextTick(scrollToBottom);
    }
    if (!contentSoFar.trim()) {
      throw new ApiError("The model finished without returning text. Check the provider log and try again.", "EMPTY_PROVIDER_RESPONSE", 502);
    }
  } catch (error) {
    if (backgroundedDuringRequest.value) {
      ui.showToast("La PWA se suspendió durante la respuesta; recuperando la conversación desde el servidor…", "info");
      scheduleRemoteRecovery();
      return;
    }
    if (error instanceof ApiError && error.code === "SERVER_OFFLINE") {
      app.setServerOnline(false);
    }
    const message = error instanceof ApiError ? error.message : error instanceof Error && error.message ? error.message : "The chat request failed";
    conversations.updateLastAssistant(active.id, `I couldn't complete that request. ${message}`);
    ui.showToast(message, "error");
  } finally {
    streaming.value = false;
    loading.value = false;
  }
}
</script>

<template>
  <section class="page-shell chat-page">
    <div class="chat-panel">
      <div ref="messageList" class="message-list scrollbar-thin">
        <div v-if="!conversation || conversation.messages.length === 0" class="empty-chat">
          <div class="empty-orb" aria-hidden="true"><img src="/icon.svg" alt="" /></div>
          <h2>Start a local conversation</h2>
          <p>Choose a model, then ask anything. Responses stream directly from your local provider.</p>
        </div>
        <MessageBubble v-for="(message, index) in conversation?.messages" :key="`${conversation?.id}-${index}`" :message="message" :streaming="streaming && index === (conversation?.messages.length ?? 0) - 1" />
      </div>
      <div v-if="composerHidden" class="composer-reveal-bar">
        <span class="text-muted">Composer hidden for reading</span>
        <button type="button" class="secondary-button" @click="composerHidden = false"><span aria-hidden="true">⌃</span> Show composer</button>
      </div>
      <div v-else class="chat-bottom">
        <div class="chat-toolbar" aria-label="Chat controls">
          <button type="button" class="composer-tool-button" aria-label="Choose model" title="Choose model" @click="modelModalOpen = true"><span aria-hidden="true">◈</span><span class="tool-button-label">Model</span></button>
          <div v-if="selectedModel" class="chat-model-summary" :title="statusMessage">
            <strong class="chat-model-name" :title="selectedModel.id">{{ selectedModel.name }}</strong>
            <span class="chat-model-provider">{{ selectedModel.provider === 'lmstudio' ? 'LM Studio' : 'Ollama' }}</span>
          </div>
          <span v-else class="text-muted">Choose a model</span>
          <ModelCapabilities :model="selectedModel" compact />
          <button type="button" class="composer-tool-button" :class="{ 'tool-button-active': toolsEnabled }" :disabled="!toolsAvailable" :aria-pressed="toolsEnabled" :aria-label="toolsAvailable ? (toolsEnabled ? 'Disable local tools' : 'Enable local tools') : 'Tools unavailable for this model'" :title="toolsAvailable ? (toolsEnabled ? 'Disable safe read-only local tools' : 'Enable safe read-only local tools') : 'This model does not report tool support'" @click="toggleTools"><span aria-hidden="true">⌘</span><span class="tool-button-label">Tools</span></button>
          <button type="button" class="composer-tool-button" aria-label="Open advanced conversation options" title="Advanced conversation options" @click="settingsModalOpen = true"><span aria-hidden="true">⚙</span><span class="tool-button-label">Options</span></button>
          <span class="connection-state" :class="connection.tone" :title="connection.detail"><span class="status-dot" :class="connection.tone === 'online' ? 'online' : 'offline'" aria-hidden="true" /><span>{{ connection.label }}</span></span>
        </div>
        <div v-if="connection.tone === 'offline'" class="provider-status-banner" role="status">
          <span class="status-dot offline" aria-hidden="true" />
          <span class="flex-1">{{ connection.detail }} <span class="text-muted">{{ app.serverOnline ? 'Check the provider service or its configured URL.' : 'Check that the Escarlet Local AI UI service is running.' }}</span></span>
          <button type="button" class="text-button" :disabled="app.loadingModels" @click="retryConnection">{{ app.loadingModels ? 'Checking…' : 'Check again' }}</button>
        </div>
        <div v-if="selectedModel && !selectedModel.loaded" class="inline-alert"><span aria-hidden="true">⌁</span><span class="flex-1">{{ selectedModel.provider === 'lmstudio' ? 'LM Studio will load this model automatically when you send the first message.' : `Load ${selectedModel.name} before chatting.` }}</span><button v-if="selectedModel.provider !== 'lmstudio'" class="text-button" :disabled="app.isBusy(selectedModel)" @click="loadSelectedModel">{{ app.isBusy(selectedModel) ? 'Loading…' : 'Load now' }}</button></div>
        <div class="composer-container">
          <button type="button" class="composer-close-button" aria-label="Hide composer" title="Hide composer to read" @click="composerHidden = true"><span aria-hidden="true">×</span></button>
          <ChatComposer :disabled="composerDisabled" :can-attach-images="Boolean(selectedModel?.capabilities?.includes('vision'))" @send="sendMessage" />
        </div>
        <p class="privacy-note">Your prompts stay between this browser and the local server.</p>
      </div>
    </div>
    <ModelSelector :selected="selectedModel" :open="modelModalOpen" @select="selectModel" @close="modelModalOpen = false" />
    <ConversationSettings v-if="conversation" :conversation="conversation" :open="settingsModalOpen" @update="updateSettings" @close="settingsModalOpen = false" />
  </section>
</template>
