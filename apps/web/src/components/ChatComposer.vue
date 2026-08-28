<script setup lang="ts">
import { nextTick, ref } from "vue";

const props = defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ send: [value: string] }>();
const value = ref("");
const textarea = ref<HTMLTextAreaElement | null>(null);

function resize(): void {
  if (!textarea.value) return;
  textarea.value.style.height = "auto";
  textarea.value.style.height = `${Math.min(textarea.value.scrollHeight, 180)}px`;
}
function submit(): void {
  const text = value.value.trim();
  if (!text || props.disabled) return;
  emit("send", text);
  value.value = "";
  void nextTick(resize);
}
function keydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submit();
  }
}
</script>

<template>
  <div class="composer-shell">
    <textarea ref="textarea" v-model="value" :disabled="props.disabled" rows="1" maxlength="200000" placeholder="Message your local model…" aria-label="Message" @input="resize" @keydown="keydown" />
    <div class="composer-footer">
      <span class="text-[11px] text-muted">Enter to send · Shift + Enter for a new line</span>
      <button class="send-button" :disabled="props.disabled || !value.trim()" aria-label="Send message" @click="submit"><span aria-hidden="true">↑</span><span class="hidden sm:inline">Send</span></button>
    </div>
  </div>
</template>
