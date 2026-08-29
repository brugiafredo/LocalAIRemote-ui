<script setup lang="ts">
import { ref } from "vue";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const password = ref("");
async function submit(): Promise<void> {
  if (await auth.login(password.value)) password.value = "";
}
</script>

<template>
  <main class="auth-page">
    <form class="auth-card" @submit.prevent="submit">
      <img class="brand-mark mx-auto" src="/icon.svg" alt="" aria-hidden="true" />
      <p class="eyebrow text-center">Private workspace</p>
      <h1 class="mt-2 text-center text-2xl font-semibold">Sign in to Local AI</h1>
      <p class="mt-2 text-center text-sm text-muted">Enter the password configured on the Local AI server.</p>
      <label class="field-label mt-6">Password <input v-model="password" type="password" autocomplete="current-password" autofocus required /></label>
      <button class="primary-button mt-5 w-full justify-center" :disabled="auth.busy">{{ auth.busy ? 'Signing in…' : 'Sign in' }}</button>
    </form>
  </main>
</template>
