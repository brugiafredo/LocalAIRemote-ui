<script setup lang="ts">
import { useUiStore } from "../stores/ui";

const ui = useUiStore();
</script>

<template>
  <Transition name="toast">
    <div v-if="ui.toast" class="toast-host" role="status" aria-live="polite">
      <div class="toast-card" :class="`toast-${ui.toast.tone}`">
        <span class="toast-icon" aria-hidden="true">{{ ui.toast.tone === 'error' ? '!' : ui.toast.tone === 'success' ? '✓' : 'i' }}</span>
        <span class="flex-1">{{ ui.toast.message }}</span>
        <button class="toast-close" aria-label="Dismiss notification" @click="ui.dismissToast">×</button>
      </div>
    </div>
  </Transition>
</template>
