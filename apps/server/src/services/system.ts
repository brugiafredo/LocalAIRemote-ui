import * as si from "systeminformation";
import type { SystemInfo } from "../types";

export class SystemService {
  async snapshot(): Promise<SystemInfo> {
    const [loadResult, memoryResult, graphicsResult, osResult, timeResult] = await Promise.allSettled([
      si.currentLoad(),
      si.mem(),
      si.graphics(),
      si.osInfo(),
      si.time(),
    ]);
    const load = loadResult.status === "fulfilled" ? loadResult.value : undefined;
    const memory = memoryResult.status === "fulfilled" ? memoryResult.value : undefined;
    const graphics = graphicsResult.status === "fulfilled" ? graphicsResult.value : undefined;
    const os = osResult.status === "fulfilled" ? osResult.value : undefined;
    const time = timeResult.status === "fulfilled" ? timeResult.value : undefined;
    const gpus = graphics?.controllers?.map((controller) => ({
      name: controller.model || controller.name || "Unknown GPU",
      memoryUsedBytes: typeof controller.vramDynamic === "number" ? controller.vramDynamic * 1024 * 1024 : null,
      memoryTotalBytes: typeof controller.vram === "number" ? controller.vram * 1024 * 1024 : null,
      usagePercent: null,
    })) ?? [];
    const totalMemory = memory?.total ?? null;
    const usedMemory = memory ? memory.total - memory.available : null;
    return {
      cpu: {
        usagePercent: load ? Number(load.currentLoad.toFixed(1)) : null,
        cores: load?.cpus?.length ?? null,
      },
      memory: {
        usedBytes: usedMemory,
        totalBytes: totalMemory,
        usagePercent: totalMemory && usedMemory !== null ? Number(((usedMemory / totalMemory) * 100).toFixed(1)) : null,
      },
      gpu: gpus,
      operatingSystem: os ? [os.distro, os.release].filter(Boolean).join(" ") : "Unknown",
      uptimeSeconds: time?.uptime ?? null,
      capturedAt: new Date().toISOString(),
    };
  }
}
