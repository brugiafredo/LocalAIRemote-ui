import { z } from "zod";

export const ProviderIdSchema = z.enum(["lmstudio", "ollama"]);

export const ModelActionSchema = z.object({
  provider: ProviderIdSchema,
  model: z.string().trim().min(1).max(500),
  contextLength: z.number().int().positive().max(1_000_000).optional(),
});

export const ChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().max(200_000),
});

export const ChatRequestSchema = z.object({
  provider: ProviderIdSchema,
  model: z.string().trim().min(1).max(500),
  messages: z.array(ChatMessageSchema).min(1).max(200),
  systemPrompt: z.string().max(50_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(1_000_000).optional(),
  contextLength: z.number().int().positive().max(1_000_000).optional(),
});
