import fs from "node:fs/promises";
import path from "node:path";
import type { Conversation } from "../types";

export type StoredConversation = Conversation & { ownerId: string; visibility: "private" | "shared"; sharedWith: string[] };

export class ConversationStore {
  private readonly filePath: string;
  private records: StoredConversation[] | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "conversations.json");
  }

  private async read(): Promise<StoredConversation[]> {
    if (this.records) return this.records;
    try {
      const raw: unknown = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      this.records = Array.isArray(raw) ? raw.filter((item): item is StoredConversation => this.isStored(item)) : [];
    } catch {
      this.records = [];
    }
    return this.records;
  }

  private isStored(value: unknown): value is StoredConversation {
    if (!value || typeof value !== "object") return false;
    const item = value as Partial<StoredConversation>;
    return typeof item.id === "string" && typeof item.title === "string" && (item.provider === "lmstudio" || item.provider === "ollama") && Array.isArray(item.messages) && typeof item.ownerId === "string";
  }

  private async write(records: StoredConversation[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, this.filePath);
    this.records = records;
  }

  async listFor(userId: string): Promise<Conversation[]> {
    const records = await this.read();
    return records.filter((item) => item.ownerId === userId || item.visibility === "shared" || item.sharedWith.includes(userId)).map(({ ownerId: _ownerId, visibility: _visibility, sharedWith: _sharedWith, ...conversation }) => conversation);
  }

  async save(userId: string, conversation: Conversation): Promise<Conversation> {
    const operation = this.writeLock.then(async () => {
      const records = await this.read();
      const existing = records.find((item) => item.id === conversation.id && item.ownerId === userId);
      const next: StoredConversation = {
        ...conversation,
        ownerId: userId,
        visibility: existing?.visibility ?? conversation.visibility ?? "shared",
        sharedWith: existing?.sharedWith ?? conversation.sharedWith ?? [],
      };
      const without = records.filter((item) => !(item.id === conversation.id && item.ownerId === userId));
      await this.write([next, ...without]);
      const { ownerId: _ownerId, visibility: _visibility, sharedWith: _sharedWith, ...result } = next;
      return result;
    });
    this.writeLock = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async remove(userId: string, id: string): Promise<void> {
    const operation = this.writeLock.then(async () => {
      const records = await this.read();
      await this.write(records.filter((item) => !(item.id === id && item.ownerId === userId)));
    });
    this.writeLock = operation.then(() => undefined, () => undefined);
    await operation;
  }
}
