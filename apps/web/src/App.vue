<script setup lang="ts">
import { onMounted } from "vue";
import AppShell from "./components/AppShell.vue";
import LoginView from "./views/LoginView.vue";
import { useAuthStore } from "./stores/auth";

const auth = useAuthStore();
onMounted(() => void auth.bootstrap());
</script>

<template>
  <div v-if="auth.loading" class="auth-loading"><div class="brand-mark">✦</div><p>Connecting to Local AI…</p></div>
  <LoginView v-else-if="auth.enabled && !auth.authenticated" />
  <AppShell v-else />
</template>
