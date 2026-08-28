import { defineStore } from "pinia";
import { computed, ref } from "vue";

export const useUiStore = defineStore("ui", () => {
  const storedTheme = localStorage.getItem("local-ai-theme");
  const theme = ref<"dark" | "light">(storedTheme === "light" ? "light" : "dark");
  const drawerOpen = ref(false);
  const toast = ref<{ id: number; message: string; tone: "info" | "success" | "error" } | null>(null);
  let toastId = 0;

  const isDark = computed(() => theme.value === "dark");
  function applyTheme(): void {
    document.documentElement.classList.toggle("dark", isDark.value);
    document.documentElement.style.colorScheme = theme.value;
    localStorage.setItem("local-ai-theme", theme.value);
  }
  function toggleTheme(): void {
    theme.value = theme.value === "dark" ? "light" : "dark";
    applyTheme();
  }
  function setDrawer(open: boolean): void {
    drawerOpen.value = open;
  }
  function showToast(message: string, tone: "info" | "success" | "error" = "info"): void {
    toastId += 1;
    toast.value = { id: toastId, message, tone };
    window.setTimeout(() => {
      if (toast.value?.id === toastId) {
        toast.value = null;
      }
    }, 4200);
  }
  function dismissToast(): void {
    toast.value = null;
  }

  applyTheme();
  return { theme, isDark, drawerOpen, toast, toggleTheme, setDrawer, showToast, dismissToast };
});
