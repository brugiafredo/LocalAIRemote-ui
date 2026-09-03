<script setup lang="ts">
import { onMounted } from "vue";
import AppShell from "./components/AppShell.vue";
import LoginView from "./views/LoginView.vue";
import { useAuthStore } from "./stores/auth";

const auth = useAuthStore();
onMounted(() => void auth.bootstrap());
</script>

<template>
  <div v-if="auth.loading" class="auth-loading"><img class="brand-mark" src="/icon.svg" alt="" aria-hidden="true" /><p>Connecting to Escarlet Local AI UI…</p></div>
  <LoginView v-else-if="auth.enabled && !auth.authenticated" />
  <AppShell v-else />
</template>
