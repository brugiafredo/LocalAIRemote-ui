<script setup lang="ts">
import { computed } from "vue";
import type { ModelInfo } from "../types";
import { useAppStore } from "../stores/app";

const props = defineProps<{ selected: ModelInfo | null }>();
const emit = defineEmits<{ select: [model: ModelInfo] }>();
const app = useAppStore();
const groups = computed(() => [
  { id: "lmstudio" as const, label: "LM Studio", models: app.models.filter((model) => model.provider === "lmstudio") },
  { id: "ollama" as const, label: "Ollama", models: app.models.filter((model) => model.provider === "ollama") },
]);
</script>

<template>
  <label class="model-select-wrap">
    <span class="sr-only">Select model</span>
    <select class="model-select" :value="selected ? app.modelKey(selected) : ''" @change="(event) => { const value = (event.target as HTMLSelectElement).value; const model = app.models.find((item) => app.modelKey(item) === value); if (model) emit('select', model); }">
      <option value="" disabled>Select a model</option>
      <optgroup v-for="group in groups" :key="group.id" :label="group.label">
        <option v-for="model in group.models" :key="app.modelKey(model)" :value="app.modelKey(model)">{{ model.name }} {{ model.loaded ? '· Loaded' : '· Not loaded' }}</option>
      </optgroup>
    </select>
    <span class="select-chevron" aria-hidden="true">⌄</span>
  </label>
</template>
