import { z } from "zod";
import type { Logger } from "pino";
import sharp from "sharp";
import opentelemetry, { SpanKind, SpanStatusCode, type Span } from "@opentelemetry/api";

import { contentTypeFromFilename } from "../utils/imageUtils";
import type { ScamClassifierMetrics } from "../infrastructure/metrics/ScamClassifierMetrics";

const tracer = opentelemetry.trace.getTracer("automod");

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
  ): Promise<ClassificationResult | { error: string }> {
    return tracer.startActiveSpan(
      "automod.classifier.classify",
      { kind: SpanKind.CLIENT, attributes: { "classifier.model": this.model, "classifier.image_count": images.length } },
      (span) => this._classify(images, span),
    );
  }

  private async _classify(
    images: { buffer: Buffer; filename: string }[],
    span: Span,
  ): Promise<ClassificationResult | { error: string }> {
    const startMs = performance.now();
    const attrs = { model: this.model };

    const MAX_ATTEMPTS = 3;
    const TIMEOUT_MS = 30_000;

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

      let resp: Response | undefined;
      let lastError: unknown;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${this.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });

          // Retry on 5xx server errors; break on success or 4xx
          if (resp.ok || (resp.status >= 400 && resp.status < 500)) {
            break;
          }

          this.logger.warn(
            { status: resp.status, model: this.model, attempt },
            "OpenRouter API returned server error, retrying",
          );
          lastError = new Error(`HTTP ${resp.status}`);
          resp = undefined;
        } catch (err) {
          lastError = err;
          this.logger.warn(
            { err, attempt },
            "OpenRouter API request failed, retrying",
          );
          resp = undefined;
        }
      }

      if (!resp) {
        this.metrics.durationHistogram.record(performance.now() - startMs, attrs);
        this.metrics.requestCounter.add(1, { ...attrs, outcome: "api_error" });
        span.setStatus({ code: SpanStatusCode.ERROR, message: "All retries exhausted" });
        span.setAttribute("classifier.outcome", "api_error");
        span.end();
        const msg = lastError instanceof Error ? lastError.message : "All retries exhausted";
        return { error: msg };
      }

      this.metrics.durationHistogram.record(performance.now() - startMs, attrs);

      if (!resp.ok) {
        this.logger.warn(
          { status: resp.status, model: this.model },
          "OpenRouter API request failed",
        );
        this.metrics.requestCounter.add(1, { ...attrs, outcome: "api_error" });
        span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${resp.status}` });
        span.setAttribute("classifier.outcome", "api_error");
        span.end();
        return { error: `API request failed (HTTP ${resp.status})` };
      }

      const data = await resp.json();

      const envelopeSchema = z.object({
        choices: z
          .array(z.object({
            finish_reason: z.string().nullable().optional(),
            message: z.object({
              content: z.string().nullable(),
              reasoning: z.string().nullable().optional(),
            }),
          }))
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
        this.logger.warn(
          { error: envelope.error.message, model: this.model },
          "Unexpected OpenRouter response shape",
        );
        this.metrics.requestCounter.add(1, { ...attrs, outcome: "envelope_error" });
        span.setStatus({ code: SpanStatusCode.ERROR, message: envelope.error.message });
        span.setAttribute("classifier.outcome", "envelope_error");
        span.end();
        return { error: "Unexpected API response shape" };
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

      const { finish_reason, message } = envelope.data.choices[0];
      span.setAttribute("classifier.finish_reason", finish_reason ?? "unknown");
      if (usage?.prompt_tokens) {
        span.setAttribute("classifier.tokens.prompt", usage.prompt_tokens);
      }
      if (usage?.completion_tokens) {
        span.setAttribute("classifier.tokens.completion", usage.completion_tokens);
      }
      if (finish_reason === "length") {
        this.logger.warn(
          { model: this.model, completion_tokens: usage?.completion_tokens },
          "OpenRouter response truncated (finish_reason=length), increase max_tokens",
        );
        span.addEvent("response_truncated");
      }

      const { content, reasoning } = message;
      if (content === null) {
        this.logger.warn(
          { model: this.model, hasReasoning: reasoning !== null && reasoning !== undefined },
          "OpenRouter response has null content, falling back to reasoning field",
        );
      }
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
        this.metrics.requestCounter.add(1, { ...attrs, outcome: "json_parse_error" });
        span.setStatus({ code: SpanStatusCode.ERROR, message: "JSON parse failed" });
        span.setAttribute("classifier.outcome", "json_parse_error");
        span.end();
        return { error: "Failed to parse API response" };
      }

      const result = classificationSchema.safeParse(parsed);
      if (!result.success) {
        this.logger.warn(
          { error: result.error.message, parsed },
          "OpenRouter response failed schema validation",
        );
        this.metrics.requestCounter.add(1, { ...attrs, outcome: "schema_error" });
        span.setStatus({ code: SpanStatusCode.ERROR, message: result.error.message });
        span.setAttribute("classifier.outcome", "schema_error");
        span.end();
        return { error: "API response failed validation" };
      }

      const outcome = result.data.isScam ? "scam" : "not_scam";
      this.metrics.requestCounter.add(1, { ...attrs, outcome });
      span.setAttributes({
        "classifier.outcome": outcome,
        "classifier.is_scam": result.data.isScam,
        "classifier.confidence": result.data.confidence,
        "classifier.has_label": result.data.suggestedLabel !== null,
      });
      span.end();
      return result.data;
    } catch (err) {
      this.logger.warn({ err }, "ScamImageClassifier.classify failed");
      this.metrics.durationHistogram.record(performance.now() - startMs, attrs);
      this.metrics.requestCounter.add(1, { ...attrs, outcome: "error" });
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.setAttribute("classifier.outcome", "error");
      span.end();
      const message = err instanceof Error ? err.message : "Unknown error";
      return { error: message };
    }
  }
}
