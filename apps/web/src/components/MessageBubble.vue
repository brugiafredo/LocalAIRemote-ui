<script setup lang="ts">
import { computed } from "vue";
import type { ChatMessage } from "../types";
import { renderMarkdown } from "../utils/markdown";

const props = defineProps<{ message: ChatMessage; streaming?: boolean }>();
const rendered = computed(() => props.message.role === "assistant" ? renderMarkdown(props.message.content || " ") : "");
</script>

<template>
  <article class="message-row" :class="message.role === 'user' ? 'message-user' : 'message-assistant'">
    <div class="message-avatar" :class="message.role === 'user' ? 'avatar-user' : 'avatar-assistant'" aria-hidden="true"><span v-if="message.role === 'user'">You</span><img v-else class="message-avatar-icon" src="/icon.svg" alt="" /></div>
    <div class="min-w-0 flex-1">
      <div class="mb-1 flex items-center gap-2 text-xs font-medium text-muted">
        <span>{{ message.role === 'user' ? 'You' : 'Assistant' }}</span>
        <span v-if="streaming" class="streaming-label"><span class="pulse-dot" /> generating</span>
      </div>
      <div v-if="message.role === 'assistant'" class="markdown-body" v-html="rendered" />
      <div v-if="message.images?.length" class="message-images" aria-label="Attached images">
        <img v-for="(image, imageIndex) in message.images" :key="image.name + '-' + imageIndex" class="message-image" :src="image.dataUrl" :alt="image.name || 'Attached image'" loading="lazy" />
      </div>
      <p v-if="message.role === 'user' && message.content" class="whitespace-pre-wrap break-words text-[15px] leading-7 text-ink">{{ message.content }}</p>
      <span v-if="streaming" class="typing-caret" aria-label="Generating response" />
    </div>
  </article>
</template>
