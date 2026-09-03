import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api, ApiError } from "../services/api";
import type { AuthStatus } from "../types";
import { useUiStore } from "./ui";

export const useAuthStore = defineStore("auth", () => {
  const status = ref<AuthStatus>({ enabled: false, authenticated: false });
  const loading = ref(true);
  const busy = ref(false);

  async function bootstrap(): Promise<void> {
    try {
      status.value = await api.authStatus();
    } catch (error) {
      status.value = { enabled: false, authenticated: false };
      useUiStore().showToast(error instanceof ApiError ? error.message : "Unable to connect to the Escarlet Local AI UI server", "error");
    } finally {
      loading.value = false;
    }
  }
  async function login(password: string): Promise<boolean> {
    busy.value = true;
    try {
      status.value = await api.login(password);
      return true;
    } catch (error) {
      useUiStore().showToast(error instanceof ApiError ? error.message : "Unable to sign in", "error");
      return false;
    } finally {
      busy.value = false;
    }
  }
  async function logout(): Promise<void> {
    await api.logout().catch(() => undefined);
    status.value = { enabled: true, authenticated: false };
  }

  const enabled = computed(() => status.value.enabled);
  const authenticated = computed(() => status.value.authenticated);
  return { status, loading, busy, enabled, authenticated, bootstrap, login, logout };
});
