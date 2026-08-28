<script setup lang="ts">
import type { Conversation } from "../types";

defineProps<{ conversation: Conversation }>();
const emit = defineEmits<{ update: [patch: Partial<Pick<Conversation, "systemPrompt" | "parameters">>] }>();
</script>

<template>
  <details class="settings-card">
    <summary><span>Conversation settings</span><span class="text-muted">⌄</span></summary>
    <div class="settings-content">
      <label class="field-label">System prompt <textarea :value="conversation.systemPrompt" rows="3" placeholder="Give this conversation a role or style…" @input="emit('update', { systemPrompt: ($event.target as HTMLTextAreaElement).value })" /></label>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label class="field-label">Temperature <input :value="conversation.parameters.temperature" type="number" min="0" max="2" step="0.1" @change="emit('update', { parameters: { ...conversation.parameters, temperature: Number(($event.target as HTMLInputElement).value) } })" /></label>
        <label class="field-label">Max tokens <input :value="conversation.parameters.maxTokens" type="number" min="1" max="1000000" step="64" @change="emit('update', { parameters: { ...conversation.parameters, maxTokens: Number(($event.target as HTMLInputElement).value) } })" /></label>
        <label class="field-label">Context length <input :value="conversation.parameters.contextLength" type="number" min="256" max="1000000" step="256" @change="emit('update', { parameters: { ...conversation.parameters, contextLength: Number(($event.target as HTMLInputElement).value) } })" /></label>
      </div>
    </div>
  </details>
</template>
