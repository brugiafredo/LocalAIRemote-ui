<script setup lang="ts">
import { computed } from "vue";
import type { ModelCapability, ModelInfo } from "../types";

const props = defineProps<{ model: ModelInfo | null; compact?: boolean }>();
const definitions: Array<{ capability: ModelCapability; icon: string; label: string }> = [
  { capability: "vision", icon: "▧", label: "Vision" },
  { capability: "reasoning", icon: "✦", label: "Reasoning" },
  { capability: "tools", icon: "⌘", label: "Tools" },
  { capability: "embedding", icon: "∿", label: "Embeddings" },
];
const visible = computed(() => definitions.filter((item) => props.model?.capabilities?.includes(item.capability)));
</script>

<template>
  <div v-if="visible.length" class="capability-list" :class="{ 'capability-list-compact': props.compact }" aria-label="Model capabilities">
    <span v-for="item in visible" :key="item.capability" class="capability-badge" :title="item.label">
      <span aria-hidden="true">{{ item.icon }}</span><span v-if="!props.compact">{{ item.label }}</span><span v-else class="sr-only">{{ item.label }}</span>
    </span>
  </div>
</template>
