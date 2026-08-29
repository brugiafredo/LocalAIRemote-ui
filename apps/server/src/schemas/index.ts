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

export const AuthLoginSchema = z.object({ password: z.string().min(1).max(500) });
export const ConversationSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().max(200),
  provider: ProviderIdSchema,
  model: z.string().max(500),
  messages: z.array(ChatMessageSchema).max(500),
  systemPrompt: z.string().max(50_000),
  parameters: z.object({
    temperature: z.number().min(0).max(2),
    maxTokens: z.number().int().positive().max(1_000_000),
    contextLength: z.number().int().positive().max(1_000_000),
  }),
  createdAt: z.string().max(100),
  updatedAt: z.string().max(100),
  ownerId: z.string().max(200).optional(),
  visibility: z.enum(["private", "shared"]).optional(),
  sharedWith: z.array(z.string().max(200)).max(100).optional(),
});
export const UpdateTokenSchema = z.object({ token: z.string().max(500).optional() });
