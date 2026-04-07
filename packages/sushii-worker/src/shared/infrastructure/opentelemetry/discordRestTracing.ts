import opentelemetry, { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { RESTOptions, ResponseLike } from "@discordjs/rest";

// Extract init type from @discordjs/rest's own makeRequest signature so we use
// the correct bundled undici RequestInit without importing undici directly.
type MakeRequestInit = Parameters<NonNullable<RESTOptions["makeRequest"]>>[1];

const tracer = opentelemetry.trace.getTracer("discord-rest");

/**
 * Drop-in replacement for the default @discordjs/rest makeRequest that wraps
 * each outgoing Discord REST call in an OTel CLIENT span.
 *
 * Pass as `rest.makeRequest` in the Discord.js Client constructor:
 *   new Client({ rest: { makeRequest: makeTracedDiscordRequest } })
 *
 * Span name uses only the HTTP method for low cardinality. Full URL and
 * response status are captured as span attributes.
 *
 * In Bun, @discordjs/rest uses global fetch (not undici.request), so init
 * is typed as the global fetch's RequestInit.
 */
export async function makeTracedDiscordRequest(
  url: string,
  init: MakeRequestInit,
): Promise<ResponseLike> {
  const method = (init.method ?? "GET").toUpperCase();

  return tracer.startActiveSpan(
    `discord.rest ${method}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "http.request.method": method,
        "url.full": url,
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
