import { z } from "zod";
import type { Logger } from "pino";

export const MAX_LABEL_LENGTH = 100;

const classificationSchema = z.object({
  isScam: z.preprocess((v) => {
    if (typeof v === "string") {
      const lower = v.toLowerCase();
      if (lower === "true") {
        return true;
      }
      if (lower === "false") {
        return false;
      }
    }
    return v;
  }, z.boolean()),
  confidence: z.preprocess(
    (v) => (typeof v === "string" ? v.toLowerCase() : v),
    z.enum(["low", "medium", "high"]),
  ),
  reason: z.string(),
  suggestedLabel: z
    .string()
    .nullable()
    .transform((v) => (v === "null" ? null : v)),
});

export type ClassificationResult = z.infer<typeof classificationSchema>;

const SYSTEM_PROMPT = `You are a Discord moderation assistant reviewing suspected scam images. These images were sent by the same user across multiple Discord servers in a short window, suggesting coordinated spam.

Common Discord scam types include:
- Casino or gambling promotions (deposit bonus, free spins, casino invites)
- Crypto airdrop or fake giveaway
- Discord Nitro or game key phishing
- Hacked account promotion spam with referral links
- Social media spam with referral codes

Respond with ONLY a JSON object, no markdown fences, no explanation:
{"isScam": true or false, "confidence": "low" or "medium" or "high", "reason": "one sentence", "suggestedLabel": "short descriptive label or null if not a scam"}`;

function mimeTypeFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") {
    return "image/jpeg";
  }
  if (ext === "gif") {
    return "image/gif";
  }
  if (ext === "webp") {
    return "image/webp";
  }
  return "image/png";
}

export class ScamImageClassifier {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly logger: Logger,
  ) {}

  async classify(
    images: { buffer: Buffer; filename: string }[],
  ): Promise<ClassificationResult | null> {
    try {
      const userText =
        images.length === 1
          ? "Review this image for scam content."
          : `Review these ${images.length} images from the same message for scam content.`;

      const imageContent = images.map((img) => {
        const mimeType = mimeTypeFromFilename(img.filename);
        const base64 = img.buffer.toString("base64");
        return {
          type: "image_url" as const,
          image_url: {
            url: `data:${mimeType};base64,${base64}`,
          },
        };
      });

      const body = {
        model: this.model,
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: userText,
              },
              ...imageContent,
            ],
          },
        ],
        max_tokens: 5000,
        temperature: 0,
      };

      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });

      if (!resp.ok) {
        this.logger.warn(
          { status: resp.status, model: this.model },
          "OpenRouter API request failed",
        );
        return null;
      }

      const data = await resp.json();
      const envelopeSchema = z.object({
        choices: z
          .array(z.object({ message: z.object({ content: z.string() }) }))
          .min(1),
      });
      const envelope = envelopeSchema.safeParse(data);
      if (!envelope.success) {
        this.logger.warn({ data }, "Unexpected OpenRouter response shape");
        return null;
      }
      const rawContent = envelope.data.choices[0].message.content.trim();

      const stripped = rawContent
        .replace(/^```(?:json)?\n?/, "")
        .replace(/\n?```$/, "")
        .trim();

      let parsed: unknown;
      try {
        parsed = JSON.parse(stripped);
      } catch (err) {
        this.logger.warn({ err, rawContent }, "Failed to parse OpenRouter response JSON");
        return null;
      }

      const result = classificationSchema.safeParse(parsed);
      if (!result.success) {
        this.logger.warn(
          { error: result.error.message, parsed },
          "OpenRouter response failed schema validation",
        );
        return null;
      }

      return result.data;
    } catch (err) {
      this.logger.warn({ err }, "ScamImageClassifier.classify failed");
      return null;
    }
  }
}
