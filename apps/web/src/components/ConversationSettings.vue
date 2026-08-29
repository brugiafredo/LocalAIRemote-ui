<script setup lang="ts">
import type { Conversation } from "../types";

const props = defineProps<{ conversation: Conversation; open: boolean }>();
const emit = defineEmits<{ update: [patch: Partial<Pick<Conversation, "systemPrompt" | "parameters">>]; close: [] }>();

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
  <Teleport to="body">
    <div v-if="props.open" class="modal-backdrop" role="presentation" @click.self="emit('close')" @keydown.esc="emit('close')">
      <section class="modal-card settings-modal" role="dialog" aria-modal="true" aria-labelledby="conversation-settings-title" tabindex="-1">
        <div class="modal-header">
          <div>
            <p class="eyebrow">Conversation</p>
            <h2 id="conversation-settings-title">Advanced options</h2>
            <p class="modal-subtitle">These settings apply only to this conversation.</p>
          </div>
          <button type="button" class="icon-button modal-close" aria-label="Close advanced options" title="Close" @click="emit('close')">×</button>
        </div>
        <div class="settings-content">
          <label class="field-label">System prompt <textarea :value="props.conversation.systemPrompt" rows="4" placeholder="Give this conversation a role or style…" @input="emit('update', { systemPrompt: ($event.target as HTMLTextAreaElement).value })" /></label>
          <div class="settings-pickers">
            <label class="field-label">Response style <select :value="props.conversation.parameters.temperature" @change="updateParameter('temperature', $event)"><option v-for="option in temperatureOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
            <label class="field-label">Max response <select :value="props.conversation.parameters.maxTokens" @change="updateParameter('maxTokens', $event)"><option v-for="value in tokenOptions" :key="value" :value="value">{{ value.toLocaleString() }} tokens</option></select></label>
            <label class="field-label">Context window <select :value="props.conversation.parameters.contextLength" @change="updateParameter('contextLength', $event)"><option v-for="value in contextOptions" :key="value" :value="value">{{ value.toLocaleString() }} tokens</option></select></label>
          </div>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-button" @click="emit('close')">Done</button></div>
      </section>
    </div>
  </Teleport>
</template>
