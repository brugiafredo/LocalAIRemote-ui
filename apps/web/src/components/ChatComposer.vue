<script setup lang="ts">
import { nextTick, ref } from "vue";
import type { ChatImage, ImageMimeType } from "../types";

const props = defineProps<{ disabled?: boolean; canAttachImages?: boolean }>();
const emit = defineEmits<{ send: [value: { content: string; images: ChatImage[] }] }>();
const value = ref("");
const pendingImages = ref<ChatImage[]>([]);
const attachmentError = ref("");
const textarea = ref<HTMLTextAreaElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const maxImageBytes = 4_000_000;
const acceptedMimeTypes: ImageMimeType[] = ["image/jpeg", "image/png", "image/webp"];

function resize(): void {
  if (!textarea.value) return;
  textarea.value.style.height = "auto";
  textarea.value.style.height = `${Math.min(textarea.value.scrollHeight, 180)}px`;
}
function submit(): void {
  const text = value.value.trim();
  if ((!text && pendingImages.value.length === 0) || props.disabled) return;
  emit("send", { content: text, images: pendingImages.value });
  value.value = "";
  pendingImages.value = [];
  attachmentError.value = "";
  void nextTick(resize);
}
function keydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submit();
  }
}
function openFilePicker(): void {
  if (!props.canAttachImages || props.disabled) return;
  fileInput.value?.click();
}
function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Unable to read image")));
    reader.addEventListener("error", () => reject(new Error("Unable to read image")));
    reader.readAsDataURL(file);
  });
}
async function addImages(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  attachmentError.value = "";
  if (files.length === 0) return;
  if (pendingImages.value.length + files.length > 2) {
    attachmentError.value = "You can attach up to 2 images per message.";
    return;
  }
  for (const file of files) {
    if (!acceptedMimeTypes.includes(file.type as ImageMimeType)) {
      attachmentError.value = "Use a JPEG, PNG, or WebP image.";
      continue;
    }
    if (file.size > maxImageBytes) {
      attachmentError.value = "Each image must be 4 MB or smaller.";
      continue;
    }
    try {
      const dataUrl = await readFile(file);
      pendingImages.value.push({ dataUrl, mimeType: file.type as ImageMimeType, name: file.name, size: file.size });
    } catch {
      attachmentError.value = "The image could not be read.";
    }
  }
}
function removeImage(index: number): void {
  pendingImages.value.splice(index, 1);
}
</script>

<template>
  <div class="composer-shell">
    <div v-if="pendingImages.length" class="attachment-preview-list" aria-label="Attached images">
      <div v-for="(image, index) in pendingImages" :key="`${image.name}-${index}`" class="attachment-preview">
        <img :src="image.dataUrl" :alt="image.name || 'Attached image'" />
        <button type="button" class="attachment-remove" :aria-label="`Remove ${image.name || 'image'}`" @click="removeImage(index)">×</button>
      </div>
    </div>
    <textarea ref="textarea" v-model="value" :disabled="props.disabled" rows="1" maxlength="200000" placeholder="Message your local model…" aria-label="Message" @input="resize" @keydown="keydown" />
    <div class="composer-footer">
      <div class="composer-actions">
        <input ref="fileInput" class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple @change="addImages" />
        <button v-if="props.canAttachImages" type="button" class="attach-button" :disabled="props.disabled || pendingImages.length >= 2" aria-label="Attach images" title="Attach JPEG, PNG, or WebP (max 4 MB each)" @click="openFilePicker"><span aria-hidden="true">▧</span><span class="hidden sm:inline">Image</span></button>
        <span class="text-[11px] text-muted">Enter to send · Shift + Enter for a new line</span>
      </div>
      <button class="send-button" :disabled="props.disabled || (!value.trim() && pendingImages.length === 0)" aria-label="Send message" @click="submit"><span aria-hidden="true">↑</span><span class="hidden sm:inline">Send</span></button>
    </div>
    <p v-if="attachmentError" class="attachment-error" role="alert">{{ attachmentError }}</p>
  </div>
</template>
