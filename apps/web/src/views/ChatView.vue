<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { api, ApiError } from "../services/api";
import { useAppStore } from "../stores/app";
import { useConversationStore } from "../stores/conversations";
import { useUiStore } from "../stores/ui";
import type { ChatMessage, ModelInfo } from "../types";
import ChatComposer from "../components/ChatComposer.vue";
import ConversationSettings from "../components/ConversationSettings.vue";
import MessageBubble from "../components/MessageBubble.vue";
import ModelSelector from "../components/ModelSelector.vue";

const app = useAppStore();
const conversations = useConversationStore();
const ui = useUiStore();
const messageList = ref<HTMLElement | null>(null);
const streaming = ref(false);
const loading = ref(false);

const conversation = computed(() => conversations.activeConversation);
const selectedModel = computed(() => {
  if (!conversation.value) return app.selectedModel;
  return app.models.find((model) => model.provider === conversation.value?.provider && model.id === conversation.value?.model) ?? app.selectedModel;
});
const statusMessage = computed(() => {
  if (!selectedModel.value) return "Choose a model to begin";
  if (!app.provider(selectedModel.value.provider).online) return `${selectedModel.value.name} · provider offline`;
  if (!selectedModel.value.loaded) return `${selectedModel.value.name} · load before chatting`;
  return `${selectedModel.value.name} · ready`;
});

watch(() => conversations.activeId, () => void nextTick(scrollToBottom));
watch(() => conversation.value?.messages.length, () => void nextTick(scrollToBottom));

function scrollToBottom(): void {
  if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight;
}
function selectModel(model: ModelInfo): void {
  app.selectModel(model);
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
async function sendMessage(content: string): Promise<void> {
  const model = selectedModel.value;
  if (!model) {
    ui.showToast("Select a model first", "info");
    return;
  }
  if (!model.loaded) {
    ui.showToast("Load this model before starting a chat", "info");
    return;
  }
  if (!conversation.value) return;
  const active = conversation.value;
  const userMessage: ChatMessage = { role: "user", content };
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
      messages: requestMessages,
      ...(active.systemPrompt.trim() ? { systemPrompt: active.systemPrompt } : {}),
      temperature: active.parameters.temperature,
      maxTokens: active.parameters.maxTokens,
      contextLength: active.parameters.contextLength,
    };
    let contentSoFar = "";
    for await (const chunk of api.chat(request)) {
      contentSoFar += chunk.text;
      conversations.updateLastAssistant(active.id, contentSoFar);
      await nextTick(scrollToBottom);
    }
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "The chat request failed";
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
    <div class="page-heading chat-heading">
      <div class="min-w-0">
        <p class="eyebrow">Local inference</p>
        <h1>Chat</h1>
        <p class="page-subtitle">A quiet space for conversations that stay on your machine.</p>
      </div>
      <div class="model-control">
        <ModelSelector :selected="selectedModel" @select="selectModel" />
        <span class="model-status" :class="selectedModel?.loaded ? 'ready' : 'muted'"><span class="status-dot" :class="selectedModel?.loaded ? 'online' : 'offline'" aria-hidden="true" />{{ statusMessage }}</span>
      </div>
    </div>

    <div class="chat-panel">
      <div ref="messageList" class="message-list scrollbar-thin">
        <div v-if="!conversation || conversation.messages.length === 0" class="empty-chat">
          <div class="empty-orb" aria-hidden="true">✦</div>
          <h2>Start a local conversation</h2>
          <p>Choose a loaded model, then ask anything. Responses stream directly from your local provider.</p>
        </div>
        <MessageBubble v-for="(message, index) in conversation?.messages" :key="`${conversation?.id}-${index}`" :message="message" :streaming="streaming && index === (conversation?.messages.length ?? 0) - 1" />
      </div>
      <div class="chat-bottom">
        <div v-if="selectedModel && !selectedModel.loaded" class="inline-alert"><span aria-hidden="true">⌁</span><span class="flex-1">Load <strong>{{ selectedModel.name }}</strong> before chatting.</span><button class="text-button" :disabled="app.isBusy(selectedModel)" @click="loadSelectedModel">{{ app.isBusy(selectedModel) ? 'Loading…' : 'Load now' }}</button></div>
        <ConversationSettings v-if="conversation" :conversation="conversation" @update="updateSettings" />
        <ChatComposer :disabled="loading || !selectedModel?.loaded" @send="sendMessage" />
        <p class="privacy-note">Your prompts stay between this browser and the local server.</p>
      </div>
    </div>
  </section>
</template>
