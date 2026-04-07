import opentelemetry, { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { RESTOptions, ResponseLike } from "@discordjs/rest";

// Extract init type from @discordjs/rest's own makeRequest signature so we use
// the correct bundled undici RequestInit without importing undici directly.
type MakeRequestInit = Parameters<NonNullable<RESTOptions["makeRequest"]>>[1];

const tracer = opentelemetry.trace.getTracer("discord-rest");

// Snowflake IDs are 17-20 digit integers.
const SNOWFLAKE_RE = /^\d{17,21}$/;
// Interaction tokens and similar credentials are long base64url strings.
const TOKEN_RE = /^[A-Za-z0-9_\-]{80,}$/;

/**
 * Replaces high-cardinality path segments with OTel-standard placeholders:
 *   - Snowflake IDs  → {id}
 *   - Long tokens    → {token}
 *
 * e.g. /api/v10/interactions/149093.../aW50ZXJhY3.../callback
 *   →  /api/v10/interactions/{id}/{token}/callback
 */
function normalizeDiscordPath(url: string): string {
  const { pathname } = new URL(url);
  return pathname
    .split("/")
    .map((segment) => {
      if (SNOWFLAKE_RE.test(segment)) return "{id}";
      if (TOKEN_RE.test(segment)) return "{token}";
      return segment;
    })
    .join("/");
}

/**
 * Drop-in replacement for the default @discordjs/rest makeRequest that wraps
 * each outgoing Discord REST call in an OTel CLIENT span.
 *
 * Pass as `rest.makeRequest` in the Discord.js Client constructor:
 *   new Client({ rest: { makeRequest: makeTracedDiscordRequest } })
 *
 * In Bun, @discordjs/rest uses global fetch (not undici.request), so init
 * is typed as the global fetch's RequestInit.
 */
export async function makeTracedDiscordRequest(
  url: string,
  init: MakeRequestInit,
): Promise<ResponseLike> {
  const method = (init.method ?? "GET").toUpperCase();
  const route = normalizeDiscordPath(url);

  return tracer.startActiveSpan(
    `discord.rest ${method} ${route}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "http.request.method": method,
        "http.route": route,
        "server.address": "discord.com",
      },
    },
    async (span) => {
      try {
        const response = await fetch(url, init as Parameters<typeof fetch>[1]);

        span.setAttribute("http.response.status_code", response.status);

        if (response.status >= 400) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `HTTP ${response.status}`,
          });
        }

        return response as unknown as ResponseLike;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}
