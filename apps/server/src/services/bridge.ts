import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ProviderId } from "../types";

const StoredSelectionSchema = z.object({
  provider: z.enum(["lmstudio", "ollama"]),
  model: z.string().min(1).max(500),
  updatedAt: z.string().max(100),
});

export interface ActiveBridgeModel {
  provider: ProviderId;
  model: string;
  updatedAt: string;
}

export class BridgeService {
  private readonly filePath: string;
  private active: ActiveBridgeModel | null = null;
  private readonly ready: Promise<void>;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "bridge-selection.json");
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    try {
      const stored = StoredSelectionSchema.parse(JSON.parse(await readFile(this.filePath, "utf8")));
      this.active = stored;
    } catch {
      this.active = null;
    }
  }

  async getActive(): Promise<ActiveBridgeModel | null> {
    await this.ready;
    return this.active;
  }

  async setActive(provider: ProviderId, model: string): Promise<ActiveBridgeModel> {
    await this.ready;
    const selection: ActiveBridgeModel = { provider, model, updatedAt: new Date().toISOString() };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(selection, null, 2) + "\n", "utf8");
    this.active = selection;
    return selection;
  }
}
