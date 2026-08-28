import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { ChatMessage, Conversation, ConversationParameters, ProviderId } from "../types";

const storageKey = "local-ai-conversations";
const defaultParameters: ConversationParameters = { temperature: 0.7, maxTokens: 1024, contextLength: 4096 };

function now(): string {
  return new Date().toISOString();
}

function titleFor(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean).slice(0, 7);
  return words.length > 0 ? words.join(" ").slice(0, 48) : "New conversation";
}

function createId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readStored(): Conversation[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.flatMap((item): Conversation[] => {
      if (typeof item !== "object" || item === null) {
        return [];
      }
      const candidate = item as Partial<Conversation>;
      if (typeof candidate.id !== "string" || typeof candidate.title !== "string" || !Array.isArray(candidate.messages)) {
        return [];
      }
      const provider: ProviderId = candidate.provider === "ollama" ? "ollama" : "lmstudio";
      return [{
        id: candidate.id,
        title: candidate.title,
        provider,
        model: typeof candidate.model === "string" ? candidate.model : "",
        messages: candidate.messages.filter((message): message is ChatMessage => typeof message === "object" && message !== null && ["system", "user", "assistant"].includes((message as ChatMessage).role) && typeof (message as ChatMessage).content === "string"),
        systemPrompt: typeof candidate.systemPrompt === "string" ? candidate.systemPrompt : "",
        parameters: { ...defaultParameters, ...(candidate.parameters ?? {}) },
        createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : now(),
        updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : now(),
      }];
    });
  } catch {
    return [];
  }
}

export const useConversationStore = defineStore("conversations", () => {
  const conversations = ref<Conversation[]>(readStored());
  const activeId = ref<string | null>(conversations.value[0]?.id ?? null);
  const activeConversation = computed(() => conversations.value.find((conversation) => conversation.id === activeId.value) ?? null);

  function persist(): void {
    localStorage.setItem(storageKey, JSON.stringify(conversations.value));
  }
  function createConversation(provider: ProviderId = "lmstudio", model = ""): Conversation {
    const timestamp = now();
    const conversation: Conversation = {
      id: createId(),
      title: "New conversation",
      provider,
      model,
      messages: [],
      systemPrompt: "",
      parameters: { ...defaultParameters },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    conversations.value.unshift(conversation);
    activeId.value = conversation.id;
    persist();
    return conversation;
  }
  function ensureConversation(provider: ProviderId, model: string): Conversation {
    return activeConversation.value ?? createConversation(provider, model);
  }
  function selectConversation(id: string): void {
    if (conversations.value.some((conversation) => conversation.id === id)) {
      activeId.value = id;
    }
  }
  function removeConversation(id: string): void {
    const index = conversations.value.findIndex((conversation) => conversation.id === id);
    if (index < 0) {
      return;
    }
    conversations.value.splice(index, 1);
    if (activeId.value === id) {
      activeId.value = conversations.value[0]?.id ?? null;
    }
    persist();
  }
  function renameConversation(id: string, title: string): void {
    const conversation = conversations.value.find((item) => item.id === id);
    if (conversation && title.trim()) {
      conversation.title = title.trim().slice(0, 80);
      conversation.updatedAt = now();
      persist();
    }
  }
  function updateConversation(id: string, patch: Partial<Pick<Conversation, "provider" | "model" | "systemPrompt" | "parameters">>): void {
    const conversation = conversations.value.find((item) => item.id === id);
    if (!conversation) {
      return;
    }
    Object.assign(conversation, patch, { updatedAt: now() });
    persist();
  }
  function addMessage(id: string, message: ChatMessage): void {
    const conversation = conversations.value.find((item) => item.id === id);
    if (!conversation) {
      return;
    }
    conversation.messages.push(message);
    if (message.role === "user" && conversation.messages.filter((item) => item.role === "user").length === 1) {
      conversation.title = titleFor(message.content);
    }
    conversation.updatedAt = now();
    persist();
  }
  function updateLastAssistant(id: string, content: string): void {
    const conversation = conversations.value.find((item) => item.id === id);
    const last = conversation?.messages[conversation.messages.length - 1];
    if (!conversation || last?.role !== "assistant") {
      return;
    }
    last.content = content;
    conversation.updatedAt = now();
    persist();
  }

  if (!activeConversation.value) {
    createConversation();
  }
  return { conversations, activeId, activeConversation, createConversation, ensureConversation, selectConversation, removeConversation, renameConversation, updateConversation, addMessage, updateLastAssistant };
});
