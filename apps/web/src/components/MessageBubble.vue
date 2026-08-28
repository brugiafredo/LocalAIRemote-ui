<script setup lang="ts">
import { computed } from "vue";
import type { ChatMessage } from "../types";
import { renderMarkdown } from "../utils/markdown";

const props = defineProps<{ message: ChatMessage; streaming?: boolean }>();
const rendered = computed(() => props.message.role === "assistant" ? renderMarkdown(props.message.content || " ") : "");
</script>

<template>
  <article class="message-row" :class="message.role === 'user' ? 'message-user' : 'message-assistant'">
    <div class="message-avatar" :class="message.role === 'user' ? 'avatar-user' : 'avatar-assistant'" aria-hidden="true">{{ message.role === 'user' ? 'You' : '✦' }}</div>
    <div class="min-w-0 flex-1">
      <div class="mb-1 flex items-center gap-2 text-xs font-medium text-muted">
        <span>{{ message.role === 'user' ? 'You' : 'Assistant' }}</span>
        <span v-if="streaming" class="streaming-label"><span class="pulse-dot" /> generating</span>
      </div>
      <div v-if="message.role === 'assistant'" class="markdown-body" v-html="rendered" />
      <p v-else class="whitespace-pre-wrap break-words text-[15px] leading-7 text-ink">{{ message.content }}</p>
      <span v-if="streaming" class="typing-caret" aria-label="Generating response" />
    </div>
  </article>
</template>
