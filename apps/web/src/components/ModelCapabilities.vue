<script setup lang="ts">
import { computed, ref } from "vue";
import type { ModelCapability, ModelInfo } from "../types";

const props = defineProps<{ model: ModelInfo | null; compact?: boolean }>();
const activeCapability = ref<ModelCapability | null>(null);
const definitions: Array<{ capability: ModelCapability; icon: string; label: string; supported: string; unsupported: string }> = [
  { capability: "vision", icon: "▧", label: "Vision", supported: "Vision — this model reports that it can analyze images.", unsupported: "Vision — this model does not report image support." },
  { capability: "reasoning", icon: "✦", label: "Reasoning", supported: "Reasoning — this model reports reasoning or thinking support.", unsupported: "Reasoning — this model does not report reasoning support." },
  { capability: "tools", icon: "⌘", label: "Tools", supported: "Tools — this model supports Escarlet Local AI UI's safe read-only tools.", unsupported: "Tools — this model does not report tool-call support." },
  { capability: "embedding", icon: "∿", label: "Embeddings", supported: "Embeddings — this model reports vector embedding support.", unsupported: "Embeddings — this model does not report embedding support." },
];
const visible = computed(() => props.model ? definitions : []);
function isSupported(capability: ModelCapability): boolean {
  return props.model?.capabilities?.includes(capability) ?? false;
}
function description(item: typeof definitions[number]): string {
  return isSupported(item.capability) ? item.supported : item.unsupported;
}
function toggleCapability(capability: ModelCapability): void {
  activeCapability.value = activeCapability.value === capability ? null : capability;
}
</script>

<template>
  <div v-if="visible.length" class="capability-list" :class="{ 'capability-list-compact': props.compact }" aria-label="Model capabilities">
    <span v-for="item in visible" :key="item.capability" class="capability-badge-wrap">
      <button type="button" class="capability-badge" :class="isSupported(item.capability) ? 'capability-supported' : 'capability-unsupported'" :title="description(item)" :aria-label="description(item)" :aria-pressed="activeCapability === item.capability" @click.stop="toggleCapability(item.capability)" @keydown.esc="activeCapability = null">
        <span class="capability-glyph" aria-hidden="true">{{ item.icon }}</span>
        <span class="capability-state" aria-hidden="true">{{ isSupported(item.capability) ? '✓' : '×' }}</span>
        <span v-if="!props.compact">{{ item.label }}</span><span v-else class="sr-only">{{ item.label }}: {{ isSupported(item.capability) ? 'supported' : 'not reported' }}</span>
      </button>
      <span v-if="activeCapability === item.capability" class="capability-tooltip" role="tooltip">{{ description(item) }}</span>
    </span>
  </div>
</template>
