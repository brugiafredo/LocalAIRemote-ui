<script setup lang="ts">
import { computed } from "vue";
import type { Conversation } from "../types";

const props = defineProps<{ conversation: Conversation }>();
const conversation = computed(() => props.conversation);
const emit = defineEmits<{ update: [patch: Partial<Pick<Conversation, "systemPrompt" | "parameters">>] }>();

const temperatureOptions = [
  { value: 0.2, label: "Precise" },
  { value: 0.7, label: "Balanced" },
  { value: 1.2, label: "Creative" },
];
const tokenOptions = [512, 1024, 2048, 4096, 8192, 16384];
const contextOptions = [2048, 4096, 8192, 16384, 32768, 65536];

function updateParameter(key: "temperature" | "maxTokens" | "contextLength", event: Event): void {
  const value = Number((event.target as HTMLSelectElement).value);
  emit("update", { parameters: { ...props.conversation.parameters, [key]: value } });
}
</script>

<template>
  <details class="settings-card">
    <summary><span>Conversation settings</span><span class="text-muted">⌄</span></summary>
    <div class="settings-content">
      <label class="field-label">System prompt <textarea :value="conversation.systemPrompt" rows="3" placeholder="Give this conversation a role or style…" @input="emit('update', { systemPrompt: ($event.target as HTMLTextAreaElement).value })" /></label>
      <div class="settings-pickers">
        <label class="field-label">Response style <select :value="conversation.parameters.temperature" @change="updateParameter('temperature', $event)"><option v-for="option in temperatureOptions" :key="option.value" :value="option.value">{{ option.label }} · {{ option.value }}</option></select></label>
        <label class="field-label">Max response <select :value="conversation.parameters.maxTokens" @change="updateParameter('maxTokens', $event)"><option v-for="value in tokenOptions" :key="value" :value="value">{{ value.toLocaleString() }} tokens</option></select></label>
        <label class="field-label">Context window <select :value="conversation.parameters.contextLength" @change="updateParameter('contextLength', $event)"><option v-for="value in contextOptions" :key="value" :value="value">{{ value.toLocaleString() }} tokens</option></select></label>
      </div>
    </div>
  </details>
</template>
