import { sleep } from "bun";
import type { Logger } from "pino";

import type {
  ImageVerdict,
  ScreeningClassifier,
  TextState,
  TextVerdict,
} from "../domain/ScreeningClassifier";
import type {
  ImageKind,
  ScreeningRule,
  ScreeningRuleId,
} from "../domain/types";

const BASE_URL = "https://openrouter.ai/api/v1";
const TIMEOUT_MS = 20_000;
const MAX_RETRY_AFTER_MS = 3_000;
export const TEXT_MODEL = "typesafe/jev-1.13";
export const IMAGE_MODEL = "google/gemini-3.5-flash-lite";

export const IMAGE_CATEGORIES = [
  "ok",
  "sexual",
  "minor_sexual",
  "gore",
  "hate",
  "scam",
] as const;
export type ImageCategory = (typeof IMAGE_CATEGORIES)[number];

/** An explicit allow list, not a guard model's taxonomy: those count profanity, weapons and
 *  copyrighted characters as unsafe, which flags ordinary avatars. */
const IMAGE_POLICY = `You review an image posted on Discord for the server's moderators. Flag it only if it clearly shows one of:
- sexual: nudity (exposed genitals, female nipples, bare buttocks), including in paintings, drawings and classical art; sex acts, pornographic or fetish imagery
- minor_sexual: any sexualized depiction of a minor, real or drawn
- gore: real or realistic graphic violence, mutilation, dead bodies, self-harm injuries
- hate: hate symbols (swastika, SS runes, KKK, etc.) or imagery demeaning a protected group
- scam: fake giveaways, free Nitro/crypto offers, QR codes or links urging people to claim something
Everything else is fine, including: selfies and photos of real people or celebrities, swimwear, revealing outfits without nudity, shirtless people, cartoons, anime, game art, logos, text, memes, crude gestures, weapons, alcohol, tobacco, drugs, skulls, dark or edgy art.
When unsure, answer "ok".`;

const IMAGE_SCHEMA = {
  name: "image_review",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["category", "reason"],
    properties: {
      category: { type: "string", enum: IMAGE_CATEGORIES },
      reason: {
        type: "string",
        description: "One short sentence describing what the image shows.",
      },
    },
  },
};

const IMAGE_CAPTION: Record<ImageKind, string> = {
  pfp: "Profile picture of a Discord user.",
  image: "Image shared in a Discord chat.",
};

// Some providers train on inputs.
const NO_DATA_COLLECTION = { data_collection: "deny" } as const;

interface OpenRouterError {
  code?: number | string;
  message?: string;
}

interface SystemOneResponse {
  model?: string;
  error?: OpenRouterError;
  answers?: Record<string, { noul?: number }>;
  usage?: { cost?: number };
}

interface ChatCompletionResponse {
  model?: string;
  error?: OpenRouterError;
  choices?: {
    finish_reason?: string | null;
    native_finish_reason?: string | null;
    error?: OpenRouterError;
    message?: { content?: string | null };
  }[];
  usage?: { cost?: number };
}

class RetryableError extends Error {
  constructor(
    message: string,
    options: ErrorOptions,
    readonly retryAfterMs = 0,
  ) {
    super(message, options);
  }
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

/** Milliseconds to wait from a seconds or HTTP-date header; 0 when absent or invalid. */
export function retryAfterMs(header: string | null, now = Date.now()): number {
  if (!header) {
    return 0;
  }
  const seconds = Number(header);
  const ms = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(header) - now;
  if (!Number.isFinite(ms) || ms <= 0) {
    return 0;
  }
  return ms;
}

export function parseImageReview(content: string): {
  unsafe: boolean;
  categories: string[];
  reason: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error("Unrecognized image review", { cause: err });
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Unrecognized image review", { cause: { parsed } });
  }
  const review = parsed as { category?: unknown; reason?: unknown };
  const category = IMAGE_CATEGORIES.find((c) => c === review.category);
  if (category === undefined) {
    throw new Error("Unrecognized image category", {
      cause: { category: review.category },
    });
  }
  const reason = typeof review.reason === "string" ? review.reason.trim() : "";
  return {
    unsafe: category !== "ok",
    categories: category === "ok" ? [] : [category],
    reason,
  };
}

function isParseableReview(content: string): boolean {
  try {
    parseImageReview(content);
    return true;
  } catch {
    // Only probing whether the content is usable; the caller throws with context.
    return false;
  }
}

export class OpenRouterScreeningClassifier implements ScreeningClassifier {
  constructor(
    private readonly apiKey: string,
    private readonly logger: Logger,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  /** One noul per rule about the new message, via OpenRouter's System One endpoint (TypeSafe shape). */
  async classifyText(
    state: TextState,
    rules: readonly ScreeningRule[],
  ): Promise<TextVerdict> {
    if (rules.length === 0) {
      return { scores: {}, model: TEXT_MODEL, cost: null };
    }
    const questions = Object.fromEntries(
      rules.map((r) => [
        r.id,
        { type: "noul", instructions: r.instructions, criteria: r.criteria },
      ]),
    );
    const json = await this.withRetry("/systemone", async () => {
      const res = (await this.postOnce("/systemone", {
        model: TEXT_MODEL,
        state,
        questions,
        provider: NO_DATA_COLLECTION,
      })) as SystemOneResponse;
      if (res.error) {
        const cause = { error: res.error };
        if (isRetryableStatus(Number(res.error.code))) {
          throw new RetryableError("systemone request failed", { cause });
        }
        throw new Error("systemone request failed", { cause });
      }
      return res;
    });

    const scores: Partial<Record<ScreeningRuleId, number>> = {};
    for (const r of rules) {
      const p = json.answers?.[r.id]?.noul;
      if (typeof p !== "number") {
        throw new Error("systemone response missing answer", {
          cause: { rule: r.id },
        });
      }
      scores[r.id] = p;
    }
    return {
      scores,
      model: json.model ?? TEXT_MODEL,
      cost: json.usage?.cost ?? null,
    };
  }

  async classifyImage(
    imageUrl: string,
    kind: ImageKind,
  ): Promise<ImageVerdict> {
    const body = {
      model: IMAGE_MODEL,
      messages: [
        { role: "system", content: IMAGE_POLICY },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl } },
            { type: "text", text: IMAGE_CAPTION[kind] },
          ],
        },
      ],
      response_format: { type: "json_schema", json_schema: IMAGE_SCHEMA },
      // Gemini 3 loops on repeated tokens below its default temperature, so none is set.
      max_tokens: 2000,
      reasoning: { effort: "low" },
      provider: NO_DATA_COLLECTION,
    };
    return this.withRetry("/chat/completions", async () =>
      this.readImageReview(
        (await this.postOnce(
          "/chat/completions",
          body,
        )) as ChatCompletionResponse,
      ),
    );
  }

  private readImageReview(json: ChatCompletionResponse): ImageVerdict {
    const choice = json.choices?.[0];
    const meta = {
      model: json.model ?? IMAGE_MODEL,
      cost: json.usage?.cost ?? null,
    };
    const finishReason = choice?.finish_reason ?? null;
    const nativeReason = choice?.native_finish_reason ?? null;

    // Provider-side filters block the worst images outright; those must surface as flags, not errors.
    if (
      finishReason === "content_filter" ||
      /SAFETY|PROHIBITED|BLOCKLIST|SPII/i.test(nativeReason ?? "")
    ) {
      return {
        unsafe: true,
        categories: ["blocked"],
        reason: `Provider refused to review it (${nativeReason || finishReason}).`,
        ...meta,
      };
    }

    // OpenRouter reports upstream failures inside a 200 response.
    const error = json.error ?? choice?.error;
    if (finishReason === "error" || error) {
      const cause = {
        finish_reason: finishReason,
        native_finish_reason: nativeReason,
        error,
      };
      if (isRetryableStatus(Number(error?.code))) {
        throw new RetryableError("OpenRouter completion failed", { cause });
      }
      throw new Error("OpenRouter completion failed", { cause });
    }

    const content = choice?.message?.content ?? "";
    if (
      finishReason !== null &&
      finishReason !== "stop" &&
      !isParseableReview(content)
    ) {
      throw new Error("OpenRouter completion ended early", {
        cause: {
          finish_reason: finishReason,
          native_finish_reason: nativeReason,
        },
      });
    }
    return { ...parseImageReview(content), ...meta };
  }

  /** One retry: OpenRouter's /systemone returns sporadic 520s and timeouts that succeed on retry. */
  private async withRetry<T>(
    path: string,
    attempt: () => Promise<T>,
  ): Promise<T> {
    try {
      return await attempt();
    } catch (err) {
      if (!(err instanceof RetryableError)) {
        throw err;
      }
      this.logger.warn(
        { err, path, retryAfterMs: err.retryAfterMs },
        "OpenRouter request failed, retrying",
      );
      if (err.retryAfterMs > 0) {
        await sleep(err.retryAfterMs);
      }
      return attempt();
    }
  }

  private async postOnce(path: string, body: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchFn(`${BASE_URL}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new RetryableError("OpenRouter request failed", { cause: err });
    }

    if (!res.ok) {
      const responseBody = (await res.text().catch(() => "")).slice(0, 300);
      const cause = { path, status: res.status, body: responseBody };
      const message = `OpenRouter request failed with status ${res.status}`;
      if (isRetryableStatus(res.status)) {
        const waitMs =
          res.status === 429 || res.status === 503
            ? retryAfterMs(res.headers.get("Retry-After"))
            : 0;
        if (waitMs > MAX_RETRY_AFTER_MS) {
          throw new Error(message, {
            cause: { ...cause, retryAfterMs: waitMs },
          });
        }
        throw new RetryableError(message, { cause }, waitMs);
      }
      throw new Error(message, { cause });
    }

    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      // Not retried: the provider already ran (and billed) the request.
      throw new Error("OpenRouter response read failed", { cause: err });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error("OpenRouter returned invalid JSON", { cause: err });
    }
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("OpenRouter returned a non-object", { cause: { path } });
    }
    return parsed;
  }
}
