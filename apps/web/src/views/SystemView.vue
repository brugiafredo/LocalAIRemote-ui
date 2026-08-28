<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { api, ApiError } from "../services/api";
import { useUiStore } from "../stores/ui";
import type { SystemInfo } from "../types";

const ui = useUiStore();
const info = ref<SystemInfo | null>(null);
const loading = ref(true);
let timer: number | undefined;

async function refresh(): Promise<void> {
  try {
    info.value = await api.system();
  } catch (error) {
    if (!info.value) ui.showToast(error instanceof ApiError ? error.message : "Unable to read system information", "error");
  } finally {
    loading.value = false;
  }
}
onMounted(async () => { await refresh(); timer = window.setInterval(() => void refresh(), 5_000); });
onUnmounted(() => { if (timer !== undefined) window.clearInterval(timer); });
function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes; let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
function formatUptime(seconds: number | null): string {
  if (seconds === null) return "—";
  const days = Math.floor(seconds / 86400); const hours = Math.floor((seconds % 86400) / 3600); const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`;
}
</script>

<template>
  <section class="page-shell">
    <div class="page-heading"><div><p class="eyebrow">Read-only telemetry</p><h1>System</h1><p class="page-subtitle">A lightweight view of the machine hosting your local models.</p></div><span class="live-indicator"><span class="pulse-dot" /> updates every 5 seconds</span></div>
    <div v-if="loading && !info" class="skeleton-grid"><div v-for="n in 4" :key="n" class="skeleton-card" /></div>
    <template v-else-if="info">
      <div class="system-grid">
        <article class="metric-card metric-wide"><div class="metric-top"><span class="metric-label">Memory</span><span class="metric-symbol" aria-hidden="true">▦</span></div><div class="metric-value">{{ formatBytes(info.memory.usedBytes) }} <span class="metric-muted">/ {{ formatBytes(info.memory.totalBytes) }}</span></div><div class="progress-track"><div class="progress-fill purple" :style="{ width: `${info.memory.usagePercent ?? 0}%` }" /></div><p class="metric-foot">{{ info.memory.usagePercent === null ? 'Usage unavailable' : `${info.memory.usagePercent}% in use` }}</p></article>
        <article class="metric-card"><div class="metric-top"><span class="metric-label">CPU</span><span class="metric-symbol" aria-hidden="true">⌁</span></div><div class="metric-value">{{ info.cpu.usagePercent === null ? '—' : `${info.cpu.usagePercent}%` }}</div><p class="metric-foot">{{ info.cpu.cores === null ? 'Core count unavailable' : `${info.cpu.cores} logical cores` }}</p></article>
        <article class="metric-card"><div class="metric-top"><span class="metric-label">Uptime</span><span class="metric-symbol" aria-hidden="true">◷</span></div><div class="metric-value">{{ formatUptime(info.uptimeSeconds) }}</div><p class="metric-foot">Since last system boot</p></article>
      </div>
      <section class="system-section"><div class="section-heading-row"><div><h2 class="section-heading">Graphics</h2><p class="text-xs text-muted">Detected adapters and reported memory.</p></div></div><div v-if="info.gpu.length" class="gpu-grid"><article v-for="gpu in info.gpu" :key="gpu.name" class="gpu-card"><div class="gpu-icon" aria-hidden="true">▰</div><div class="min-w-0"><h3 class="truncate font-semibold" :title="gpu.name">{{ gpu.name }}</h3><p class="mt-1 text-xs text-muted">{{ formatBytes(gpu.memoryUsedBytes) }} used · {{ formatBytes(gpu.memoryTotalBytes) }} total</p></div></article></div><div v-else class="empty-provider"><span aria-hidden="true">◌</span><div><p>No graphics adapter data reported</p><span>The operating system did not expose GPU telemetry.</span></div></div></section>
      <section class="system-section"><div class="section-heading-row"><div><h2 class="section-heading">Host</h2><p class="text-xs text-muted">Environment details for this Local AI server.</p></div></div><div class="host-card"><div><span class="metric-label">Operating system</span><p class="mt-2 font-medium">{{ info.operatingSystem }}</p></div><div><span class="metric-label">Last updated</span><p class="mt-2 font-medium">{{ new Date(info.capturedAt).toLocaleTimeString() }}</p></div></div></section>
    </template>
  </section>
</template>
