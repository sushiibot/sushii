import { URL } from "node:url";
import type { RequestMethod, REST, RouteLike } from "@discordjs/rest";
import { DiscordAPIError, HTTPError, RateLimitError } from "@discordjs/rest";

/**
 * Creates a Bun fetch handler used to forward requests to Discord
 *
 * @param rest - REST instance to use for the requests
 */
export function proxyRequests(rest: REST) {
  return async (request: Request): Promise<Response> => {
    const { method, url } = request;

    // The 2nd parameter is here so the URL constructor doesn't complain about an "invalid url" when the origin is missing
    // we don't actually care about the origin and the value passed is irrelevant
    const parsedUrl = new URL(url, "http://noop");
    // eslint-disable-next-line prefer-named-capture-group
    const fullRoute = parsedUrl.pathname.replace(
      /^\/api(\/v\d+)?/,
      "",
    ) as RouteLike;

    const headers: Record<string, string> = {};

    const contentType = request.headers.get("content-type");
    if (contentType) {
      headers["Content-Type"] = contentType;
    }

    const authorization = request.headers.get("authorization");
    if (authorization) {
      headers.authorization = authorization;
    }

    const auditLogReason = request.headers.get("x-audit-log-reason");
    if (auditLogReason) {
      headers["x-audit-log-reason"] = auditLogReason;
    }

    try {
      const discordResponse = await rest.queueRequest({
        body: request.body,
        fullRoute,
        // This type cast is technically incorrect, but we want Discord to throw Method Not Allowed for us
        method: method as RequestMethod,
        // We forward the auth header anyway
        auth: false,
        passThroughBody: true,
        query: parsedUrl.searchParams,
        headers,
      });

      const responseHeaders = new Headers();
      for (const [header, value] of discordResponse.headers) {
        // Strip ratelimit headers but preserve compression headers
        if (!/^x-ratelimit/i.test(header)) {
          responseHeaders.set(header, value);
        }
      }

      // The REST library with passThroughBody: true may decompress the response
      // but leave compression headers
      // Remove compression headers to prevent client decompression errors:
      // "Decompression error: ZlibError"
      if (responseHeaders.has("content-encoding")) {
        responseHeaders.delete("content-encoding");
        responseHeaders.delete("content-length");
      }

      return new Response(discordResponse.body as ReadableStream, {
        status: discordResponse.status,
        headers: responseHeaders,
      });
    } catch (error) {
      if (error instanceof DiscordAPIError || error instanceof HTTPError) {
        const responseHeaders = new Headers();
        if ("rawError" in error) {
          responseHeaders.set("Content-Type", "application/json");
          return new Response(JSON.stringify(error.rawError), {
            status: error.status,
            headers: responseHeaders,
          });
        }
        return new Response(null, { status: error.status });
      } else if (error instanceof RateLimitError) {
        const responseHeaders = new Headers();
        responseHeaders.set("Retry-After", String(error.timeToReset / 1_000));
        return new Response(null, {
          status: 429,
          headers: responseHeaders,
        });
      } else if (error instanceof Error && error.name === "AbortError") {
        return new Response(null, {
          status: 504,
          statusText: "Upstream timed out",
        });
      } else {
        console.error(`Error while processing request:`, {
          error,
          method,
          url,
        });
        throw error;
      }
    }
  };
}
