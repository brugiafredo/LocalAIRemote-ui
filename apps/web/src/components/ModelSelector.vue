<script setup lang="ts">
import { computed } from "vue";
import type { ModelCapability, ModelInfo } from "../types";
import { useAppStore } from "../stores/app";

const props = defineProps<{ selected: ModelInfo | null; open: boolean }>();
const emit = defineEmits<{ select: [model: ModelInfo]; close: [] }>();
const app = useAppStore();

const groups = computed(() => [
  { id: "lmstudio" as const, label: "LM Studio", models: app.models.filter((model) => model.provider === "lmstudio") },
  { id: "ollama" as const, label: "Ollama", models: app.models.filter((model) => model.provider === "ollama") },
]);

function capabilityMarker(capability: ModelCapability): string {
  return { vision: "▧", reasoning: "✦", tools: "⌘", embedding: "∿" }[capability];
}
function selectModel(model: ModelInfo): void {
  emit("select", model);
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div v-if="props.open" class="modal-backdrop" role="presentation" @click.self="emit('close')" @keydown.esc="emit('close')">
      <section class="modal-card model-picker-modal" role="dialog" aria-modal="true" aria-labelledby="model-picker-title" tabindex="-1">
        <div class="modal-header">
          <div>
            <p class="eyebrow">Local inference</p>
            <h2 id="model-picker-title">Choose a model</h2>
            <p class="modal-subtitle">Switch providers without leaving the conversation.</p>
          </div>
          <button type="button" class="icon-button modal-close" aria-label="Close model selector" title="Close" @click="emit('close')">×</button>
        </div>

        <div class="model-picker-list">
          <section v-for="group in groups" :key="group.id" class="model-picker-group" :aria-labelledby="`model-picker-${group.id}`">
            <div class="model-picker-group-heading">
              <span class="provider-heading-dot" :class="group.id" aria-hidden="true" />
              <h3 :id="`model-picker-${group.id}`">{{ group.label }}</h3>
              <span class="model-picker-provider-status" :class="app.provider(group.id).online ? 'online' : 'offline'">{{ app.provider(group.id).online ? 'online' : 'offline' }}</span>
            </div>
            <p v-if="group.models.length === 0" class="model-picker-empty">No models detected for {{ group.label }}.</p>
            <button v-for="model in group.models" :key="app.modelKey(model)" type="button" class="model-picker-option" :class="{ selected: selected && app.modelKey(selected) === app.modelKey(model) }" @click="selectModel(model)">
              <span class="model-picker-option-main">
                <strong>{{ model.name }}</strong>
                <span>{{ model.loaded ? 'Loaded and ready' : model.provider === 'lmstudio' ? 'Loads on first message' : 'Not loaded' }}</span>
              </span>
              <span v-if="model.capabilities?.length" class="model-picker-capabilities" :aria-label="`Capabilities: ${model.capabilities.join(', ')}`">
                <span v-for="capability in model.capabilities" :key="capability" aria-hidden="true">{{ capabilityMarker(capability) }}</span>
              </span>
              <span class="model-picker-check" aria-hidden="true">{{ selected && app.modelKey(selected) === app.modelKey(model) ? '✓' : '' }}</span>
            </button>
          </section>
        </div>
      </section>
    </div>
  </Teleport>
</template>
