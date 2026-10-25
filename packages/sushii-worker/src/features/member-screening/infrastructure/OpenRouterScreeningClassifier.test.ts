import { describe, expect, test } from "bun:test";
import pino from "pino";

import { SCREENING_RULES } from "../domain/rules";
import {
  IMAGE_MODEL,
  OpenRouterScreeningClassifier,
  TEXT_MODEL,
  parseImageReview,
  retryAfterMs,
} from "./OpenRouterScreeningClassifier";

const logger = pino({ level: "silent" });

interface Call {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function fakeFetch(
  respond: (call: Call, n: number) => Response | Promise<Response>,
): {
  fetchFn: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const call = { url, init, body: JSON.parse(init.body as string) };
    calls.push(call);
    return respond(call, calls.length);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

function classifier(fetchFn: typeof fetch): OpenRouterScreeningClassifier {
  return new OpenRouterScreeningClassifier("test-key", logger, fetchFn);
}

function textAnswers(scam = 0.95): Response {
  const answers = Object.fromEntries(
    SCREENING_RULES.map((r) => [
      r.id,
      { type: "noul", noul: r.id === "scam" ? scam : 0.01 },
    ]),
  );
  return Response.json({
    model: "typesafe/jev-1.13-20260917",
    answers,
    usage: { cost: 0.00001 },
  });
}

const state = { new_message: { text: "x" } };
const scamOnly = SCREENING_RULES.filter((r) => r.id === "scam");

describe("parseImageReview", () => {
  test("ok and unsafe categories", () => {
    expect(parseImageReview('{"category":"ok","reason":"A cat."}')).toEqual({
      unsafe: false,
      categories: [],
      reason: "A cat.",
    });
    expect(
      parseImageReview('{"category":"hate","reason":" A swastika. "}'),
    ).toEqual({ unsafe: true, categories: ["hate"], reason: "A swastika." });
  });

  test("throws on unknown categories and non-JSON", () => {
    expect(() =>
      parseImageReview('{"category":"violence","reason":""}'),
    ).toThrow("Unrecognized image category");
    expect(() => parseImageReview("I cannot help")).toThrow(
      "Unrecognized image review",
    );
    expect(() => parseImageReview("null")).toThrow("Unrecognized image review");
    expect(() => parseImageReview("3")).toThrow("Unrecognized image review");
  });
});

describe("retryAfterMs", () => {
  test("reads seconds and HTTP dates", () => {
    expect(retryAfterMs(null)).toBe(0);
    expect(retryAfterMs("1")).toBe(1000);
    expect(retryAfterMs("120")).toBe(120_000);
    expect(retryAfterMs(new Date(2_000).toUTCString(), 0)).toBe(2000);
    expect(retryAfterMs("soon")).toBe(0);
    expect(retryAfterMs("-5")).toBe(0);
  });
});

describe("classifyText", () => {
  test("no rules returns empty scores without calling fetch", async () => {
    const { fetchFn, calls } = fakeFetch(() => textAnswers());
    expect(await classifier(fetchFn).classifyText(state, [])).toEqual({
      scores: {},
      model: TEXT_MODEL,
      cost: null,
    });
    expect(calls).toHaveLength(0);
  });

  test("waits for Retry-After on a 429 before retrying", async () => {
    let firstAt = 0;
    let secondAt = 0;
    const { fetchFn, calls } = fakeFetch((_c, n) => {
      if (n === 1) {
        firstAt = performance.now();
        return new Response("slow down", {
          status: 429,
          headers: { "Retry-After": "0.05" },
        });
      }
      secondAt = performance.now();
      return Response.json({ answers: { scam: { noul: 0.3 } } });
    });
    await classifier(fetchFn).classifyText(state, scamOnly);
    expect(calls).toHaveLength(2);
    expect(secondAt - firstAt).toBeGreaterThanOrEqual(40);
  });

  test("does not retry a Retry-After beyond 3s", async () => {
    const { fetchFn, calls } = fakeFetch(
      () =>
        new Response("slow down", {
          status: 429,
          headers: { "Retry-After": "30" },
        }),
    );
    const err = await classifier(fetchFn)
      .classifyText(state, scamOnly)
      .catch((e: unknown) => e);
    expect(calls).toHaveLength(1);
    expect((err as Error).message).toContain("429");
    expect((err as Error).cause).toMatchObject({
      status: 429,
      retryAfterMs: 30_000,
    });
  });

  test("a body read failure after a 200 is not retried", async () => {
    const { fetchFn, calls } = fakeFetch(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("aborted"));
            },
          }),
        ),
    );
    const err = await classifier(fetchFn)
      .classifyText(state, scamOnly)
      .catch((e: unknown) => e);
    expect(calls).toHaveLength(1);
    expect((err as Error).message).toBe("OpenRouter response read failed");
    expect((err as Error).cause).toBeInstanceOf(Error);
  });

  test("a null body throws without retrying", async () => {
    const { fetchFn, calls } = fakeFetch(() => new Response("null"));
    const err = await classifier(fetchFn)
      .classifyText(state, scamOnly)
      .catch((e: unknown) => e);
    expect(calls).toHaveLength(1);
    expect((err as Error).message).toBe("OpenRouter returned a non-object");
    expect((err as Error).cause).toEqual({ path: "/systemone" });
  });

  test("retries once on a 5xx error object inside a 200", async () => {
    const { fetchFn, calls } = fakeFetch((_c, n) =>
      n === 1
        ? Response.json({ error: { code: 502, message: "Upstream error" } })
        : Response.json({ answers: { scam: { noul: 0.4 } } }),
    );
    const v = await classifier(fetchFn).classifyText(state, scamOnly);
    expect(calls).toHaveLength(2);
    expect(v.scores.scam).toBe(0.4);
  });

  test("a 4xx error object inside a 200 throws with its cause", async () => {
    const error = { code: 400, message: "Bad state" };
    const { fetchFn, calls } = fakeFetch(() => Response.json({ error }));
    const err = await classifier(fetchFn)
      .classifyText(state, scamOnly)
      .catch((e: unknown) => e);
    expect(calls).toHaveLength(1);
    expect((err as Error).message).toBe("systemone request failed");
    expect((err as Error).cause).toEqual({ error });
  });

  test("invalid JSON in a 200 throws without retrying", async () => {
    const { fetchFn, calls } = fakeFetch(() => new Response("<html>"));
    const err = await classifier(fetchFn)
      .classifyText(state, scamOnly)
      .catch((e: unknown) => e);
    expect(calls).toHaveLength(1);
    expect((err as Error).message).toBe("OpenRouter returned invalid JSON");
    expect((err as Error).cause).toBeInstanceOf(SyntaxError);
  });

  test("posts one noul per rule to /systemone and reads answers", async () => {
    const { fetchFn, calls } = fakeFetch(() => textAnswers());
    const v = await classifier(fetchFn).classifyText(state, SCREENING_RULES);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe("https://openrouter.ai/api/v1/systemone");
    expect(call?.init.method).toBe("POST");
    expect(new Headers(call?.init.headers).get("Authorization")).toBe(
      "Bearer test-key",
    );
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
    expect(call?.body).toMatchObject({
      model: TEXT_MODEL,
      state,
      provider: { data_collection: "deny" },
    });
    const questions = call?.body.questions as Record<string, unknown>;
    expect(Object.keys(questions)).toEqual(SCREENING_RULES.map((r) => r.id));
    expect(questions.scam).toMatchObject({
      type: "noul",
      instructions: SCREENING_RULES[0]?.instructions,
    });
    expect(questions.scam).toHaveProperty("criteria.false.examples");

    expect(v.scores.scam).toBe(0.95);
    expect(v.model).toBe("typesafe/jev-1.13-20260917");
    expect(v.cost).toBe(0.00001);
  });

  test("defaults model and cost when the response omits them", async () => {
    const { fetchFn } = fakeFetch(() =>
      Response.json({ answers: { scam: { noul: 0.2 } } }),
    );
    const v = await classifier(fetchFn).classifyText(state, scamOnly);
    expect(v).toEqual({ scores: { scam: 0.2 }, model: TEXT_MODEL, cost: null });
  });

  test("throws when a rule's answer is missing", async () => {
    const { fetchFn } = fakeFetch(() => Response.json({ answers: {} }));
    await expect(
      classifier(fetchFn).classifyText(state, scamOnly),
    ).rejects.toThrow("systemone response missing answer");
  });

  test("retries once on a 5xx", async () => {
    const { fetchFn, calls } = fakeFetch((_c, n) =>
      n === 1
        ? new Response("error code: 520", { status: 520 })
        : Response.json({ answers: { scam: { noul: 0.2 } } }),
    );
    const v = await classifier(fetchFn).classifyText(state, scamOnly);
    expect(calls).toHaveLength(2);
    expect(v.scores.scam).toBe(0.2);
  });

  test("retries once on a 429", async () => {
    const { fetchFn, calls } = fakeFetch((_c, n) =>
      n === 1
        ? new Response("slow down", { status: 429 })
        : Response.json({ answers: { scam: { noul: 0.3 } } }),
    );
    await classifier(fetchFn).classifyText(state, scamOnly);
    expect(calls).toHaveLength(2);
  });

  test("retries once on a network error", async () => {
    const { fetchFn, calls } = fakeFetch((_c, n) => {
      if (n === 1) {
        throw new TypeError("fetch failed");
      }
      return Response.json({ answers: { scam: { noul: 0.4 } } });
    });
    const v = await classifier(fetchFn).classifyText(state, scamOnly);
    expect(calls).toHaveLength(2);
    expect(v.scores.scam).toBe(0.4);
  });

  test("gives up after the one retry, keeping the cause", async () => {
    const { fetchFn, calls } = fakeFetch(
      () => new Response("bad gateway", { status: 502 }),
    );
    const err = await classifier(fetchFn)
      .classifyText(state, scamOnly)
      .catch((e: unknown) => e);
    expect(calls).toHaveLength(2);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("502");
    expect((err as Error).cause).toMatchObject({
      path: "/systemone",
      status: 502,
      body: "bad gateway",
    });
  });

  test("does not retry a 4xx", async () => {
    const { fetchFn, calls } = fakeFetch(
      () => new Response("bad request", { status: 400 }),
    );
    await expect(
      classifier(fetchFn).classifyText(state, SCREENING_RULES),
    ).rejects.toThrow("400");
    expect(calls).toHaveLength(1);
  });
});

describe("classifyImage", () => {
  function okResponse(): Response {
    return Response.json({
      model: "google/gemini-3.5-flash-lite-001",
      choices: [
        { message: { content: '{"category":"ok","reason":"A cat."}' } },
      ],
      usage: { cost: 0.0005 },
    });
  }

  test("posts the policy, schema and caption by kind", async () => {
    const { fetchFn, calls } = fakeFetch(() => okResponse());
    const c = classifier(fetchFn);
    expect(
      await c.classifyImage("https://cdn.discordapp.com/a.png", "pfp"),
    ).toEqual({
      unsafe: false,
      categories: [],
      reason: "A cat.",
      model: "google/gemini-3.5-flash-lite-001",
      cost: 0.0005,
    });
    await c.classifyImage("https://cdn.discordapp.com/b.png", "image");

    const [pfp, image] = calls;
    expect(pfp?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(pfp?.body).toMatchObject({
      model: IMAGE_MODEL,
      provider: { data_collection: "deny" },
      response_format: {
        type: "json_schema",
        json_schema: { name: "image_review", strict: true },
      },
    });
    expect(pfp?.body.temperature).toBeUndefined();
    const messages = pfp?.body.messages as {
      role: string;
      content: unknown;
    }[];
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain('When unsure, answer "ok".');
    expect(messages[1]?.content).toEqual([
      {
        type: "image_url",
        image_url: { url: "https://cdn.discordapp.com/a.png" },
      },
      { type: "text", text: "Profile picture of a Discord user." },
    ]);
    const imageMessages = image?.body.messages as { content: unknown }[];
    expect(imageMessages[1]?.content).toContainEqual({
      type: "text",
      text: "Image shared in a Discord chat.",
    });
  });

  test("flags images the provider refuses as blocked", async () => {
    const { fetchFn } = fakeFetch(() =>
      Response.json({
        choices: [
          {
            finish_reason: "content_filter",
            native_finish_reason: "PROHIBITED_CONTENT",
            message: { content: "" },
          },
        ],
      }),
    );
    expect(
      await classifier(fetchFn).classifyImage(
        "https://cdn.discordapp.com/a.png",
        "pfp",
      ),
    ).toEqual({
      unsafe: true,
      categories: ["blocked"],
      reason: "Provider refused to review it (PROHIBITED_CONTENT).",
      model: IMAGE_MODEL,
      cost: null,
    });
  });

  test("flags a native safety stop without content_filter", async () => {
    const { fetchFn } = fakeFetch(() =>
      Response.json({
        choices: [
          {
            finish_reason: "stop",
            native_finish_reason: "SAFETY",
            message: {},
          },
        ],
      }),
    );
    const v = await classifier(fetchFn).classifyImage(
      "https://cdn.discordapp.com/a.png",
      "image",
    );
    expect(v.categories).toEqual(["blocked"]);
  });

  test("retries once on an upstream error inside a 200", async () => {
    const { fetchFn, calls } = fakeFetch((_c, n) =>
      n === 1
        ? Response.json({
            choices: [
              {
                finish_reason: "error",
                native_finish_reason: null,
                error: { code: 502, message: "Upstream error" },
                message: { content: "" },
              },
            ],
          })
        : okResponse(),
    );
    const v = await classifier(fetchFn).classifyImage(
      "https://cdn.discordapp.com/a.png",
      "pfp",
    );
    expect(calls).toHaveLength(2);
    expect(v.reason).toBe("A cat.");
  });

  test("a non-retryable error inside a 200 throws with its cause", async () => {
    const { fetchFn, calls } = fakeFetch(() =>
      Response.json({ error: { code: 400, message: "Bad image" } }),
    );
    const err = await classifier(fetchFn)
      .classifyImage("https://cdn.discordapp.com/a.png", "pfp")
      .catch((e: unknown) => e);
    expect(calls).toHaveLength(1);
    expect((err as Error).message).toBe("OpenRouter completion failed");
    expect((err as Error).cause).toEqual({
      finish_reason: null,
      native_finish_reason: null,
      error: { code: 400, message: "Bad image" },
    });
  });

  test("a truncated review throws with the finish reason", async () => {
    const { fetchFn, calls } = fakeFetch(() =>
      Response.json({
        choices: [
          {
            finish_reason: "length",
            native_finish_reason: "MAX_TOKENS",
            message: { content: '{"category":"ok","rea' },
          },
        ],
      }),
    );
    const err = await classifier(fetchFn)
      .classifyImage("https://cdn.discordapp.com/a.png", "pfp")
      .catch((e: unknown) => e);
    expect(calls).toHaveLength(1);
    expect((err as Error).message).toBe("OpenRouter completion ended early");
    expect((err as Error).cause).toEqual({
      finish_reason: "length",
      native_finish_reason: "MAX_TOKENS",
    });
  });

  test("a length stop with a complete review is still used", async () => {
    const { fetchFn } = fakeFetch(() =>
      Response.json({
        choices: [
          {
            finish_reason: "length",
            message: { content: '{"category":"ok","reason":"A cat."}' },
          },
        ],
      }),
    );
    const v = await classifier(fetchFn).classifyImage(
      "https://cdn.discordapp.com/a.png",
      "pfp",
    );
    expect(v.unsafe).toBe(false);
  });

  test("a provider block wins over an error object", async () => {
    const { fetchFn } = fakeFetch(() =>
      Response.json({
        error: { code: 400, message: "Blocked" },
        choices: [
          {
            finish_reason: "error",
            native_finish_reason: "PROHIBITED_CONTENT",
            message: { content: "" },
          },
        ],
      }),
    );
    const v = await classifier(fetchFn).classifyImage(
      "https://cdn.discordapp.com/a.png",
      "pfp",
    );
    expect(v).toMatchObject({ unsafe: true, categories: ["blocked"] });
  });

  test("a null completion body throws without retrying", async () => {
    const { fetchFn, calls } = fakeFetch(() => new Response("null"));
    const err = await classifier(fetchFn)
      .classifyImage("https://cdn.discordapp.com/a.png", "pfp")
      .catch((e: unknown) => e);
    expect(calls).toHaveLength(1);
    expect((err as Error).message).toBe("OpenRouter returned a non-object");
    expect((err as Error).cause).toEqual({ path: "/chat/completions" });
  });

  test("throws on an unparseable review", async () => {
    const { fetchFn } = fakeFetch(() =>
      Response.json({ choices: [{ message: { content: "no" } }] }),
    );
    await expect(
      classifier(fetchFn).classifyImage(
        "https://cdn.discordapp.com/a.png",
        "pfp",
      ),
    ).rejects.toThrow("Unrecognized image review");
  });
});
