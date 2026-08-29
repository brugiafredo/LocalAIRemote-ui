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
  images: z.array(z.object({
    dataUrl: z.string().regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/, "Only base64 JPEG, PNG, and WebP images are supported"),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    name: z.string().max(255).optional(),
    size: z.number().int().positive().max(4_000_000).optional(),
  }).superRefine((image, context) => {
    const comma = image.dataUrl.indexOf(",");
    const encoded = image.dataUrl.slice(comma + 1);
    const decodedBytes = Math.floor(encoded.length * 3 / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
    if (decodedBytes > 4_000_000) {
      context.addIssue({ code: z.ZodIssueCode.too_big, maximum: 4_000_000, type: "number", inclusive: true, message: "Each image must be 4 MB or smaller" });
    }
    if (!image.dataUrl.startsWith(`data:${image.mimeType};base64,`)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Image MIME type does not match its data" });
    }
  })).max(2).optional(),
});

export const ChatRequestSchema = z.object({
  provider: ProviderIdSchema,
  model: z.string().trim().min(1).max(500),
  messages: z.array(ChatMessageSchema).min(1).max(200),
  systemPrompt: z.string().max(50_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(1_000_000).optional(),
  contextLength: z.number().int().positive().max(1_000_000).optional(),
  enableTools: z.boolean().optional(),
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
