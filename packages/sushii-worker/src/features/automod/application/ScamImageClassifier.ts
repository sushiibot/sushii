import { z } from "zod";
import type { Logger } from "pino";
import sharp from "sharp";

import { contentTypeFromFilename } from "../utils/imageUtils";
import type { ScamClassifierMetrics } from "../infrastructure/metrics/ScamClassifierMetrics";

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

For suggestedLabel, use the format: "[platform] [impersonated account] - [scam site domain]"
Examples:
- "twitter Andrew Tate - tasowin.com"
- "twitter MrBeast - xoergamb.com"
- "discord nitro - free-nitro.gg"
Omit parts that are not present. Use null if not a scam.

For reason: write at most 15 words. Name the scam type and target (e.g. "Fake MrBeast crypto giveaway promoting buragamb.com"). No full sentences.

Respond with ONLY a JSON object, no markdown fences, no explanation:
{"isScam": true or false, "confidence": "low" or "medium" or "high", "reason": "≤15 words", "suggestedLabel": "[platform] [impersonated account] - [scam site domain] or null if not a scam"}`;

const CLASSIFIER_MAX_DIMENSION = 1024;

async function resizeForClassifier(buffer: Buffer): Promise<Buffer> {
  const meta = await sharp(buffer).metadata();
  const { width, height } = meta;
  if (
    (!width || width <= CLASSIFIER_MAX_DIMENSION) &&
    (!height || height <= CLASSIFIER_MAX_DIMENSION)
  ) {
    return buffer;
  }
  return sharp(buffer)
    .resize(CLASSIFIER_MAX_DIMENSION, CLASSIFIER_MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
    .toBuffer();
}

export class ScamImageClassifier {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly logger: Logger,
    private readonly metrics: ScamClassifierMetrics,
  ) {}

  async classify(
    images: { buffer: Buffer; filename: string }[],
  ): Promise<ClassificationResult | null> {
    const startMs = performance.now();
    const attrs = { model: this.model };

    try {
      const userText =
        images.length === 1
          ? "Review this image for scam content."
          : `Review these ${images.length} images from the same message for scam content.`;

      const imageContent = await Promise.all(images.map(async (img) => {
        // Pass image/png as fallback — vision APIs require a valid image MIME in data URLs
        const mimeType = contentTypeFromFilename(img.filename, "image/png");
        const resized = await resizeForClassifier(img.buffer);
        const base64 = resized.toString("base64");
        return {
          type: "image_url" as const,
          image_url: {
            url: `data:${mimeType};base64,${base64}`,
          },
        };
      }));

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
        max_tokens: 2000,
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

      this.metrics.durationHistogram.record(performance.now() - startMs, attrs);

      if (!resp.ok) {
        this.logger.warn(
          { status: resp.status, model: this.model },
          "OpenRouter API request failed",
        );
        this.metrics.requestCounter.add(1, { ...attrs, outcome: "api_error" });
        return null;
      }

      const data = await resp.json();

      const envelopeSchema = z.object({
        choices: z
          .array(z.object({ message: z.object({ content: z.string().nullable(), reasoning: z.string().nullable().optional() }) }))
          .min(1),
        usage: z
          .object({
            prompt_tokens: z.number().optional(),
            completion_tokens: z.number().optional(),
          })
          .optional(),
      });
      const envelope = envelopeSchema.safeParse(data);
      if (!envelope.success) {
        this.logger.warn({ data }, "Unexpected OpenRouter response shape");
        this.metrics.requestCounter.add(1, { ...attrs, outcome: "parse_failed" });
        return null;
      }

      const { usage } = envelope.data;
      if (usage) {
        if (usage.prompt_tokens) {
          this.metrics.tokenCounter.add(usage.prompt_tokens, { ...attrs, token_type: "input" });
        }
        if (usage.completion_tokens) {
          this.metrics.tokenCounter.add(usage.completion_tokens, { ...attrs, token_type: "output" });
        }
      }

      const { content, reasoning } = envelope.data.choices[0].message;
      const rawContent = (content ?? reasoning ?? "").trim();

      const stripped = rawContent
        .replace(/^```(?:json)?\n?/, "")
        .replace(/\n?```$/, "")
        .trim();

      let parsed: unknown;
      try {
        parsed = JSON.parse(stripped);
      } catch (err) {
        this.logger.warn({ err, rawContent }, "Failed to parse OpenRouter response JSON");
        this.metrics.requestCounter.add(1, { ...attrs, outcome: "parse_failed" });
        return null;
      }

      const result = classificationSchema.safeParse(parsed);
      if (!result.success) {
        this.logger.warn(
          { error: result.error.message, parsed },
          "OpenRouter response failed schema validation",
        );
        this.metrics.requestCounter.add(1, { ...attrs, outcome: "parse_failed" });
        return null;
      }

      this.metrics.requestCounter.add(1, {
        ...attrs,
        outcome: result.data.isScam ? "scam" : "not_scam",
      });

      return result.data;
    } catch (err) {
      this.logger.warn({ err }, "ScamImageClassifier.classify failed");
      this.metrics.durationHistogram.record(performance.now() - startMs, attrs);
      this.metrics.requestCounter.add(1, { ...attrs, outcome: "error" });
      return null;
    }
  }
}
