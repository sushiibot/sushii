import { RelayQueue } from "./relay";
import { ApprovalService } from "./service";
import { boundedBody, equalSecret, validSignature } from "./security";
import { ExpectedError } from "./types";

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const supported = new Set([
  "deployment_review",
  "workflow_run",
  "status",
  "github_app_authorization",
  "ping",
]);
function bearer(request: Request, expected: string) {
  if (
    !expected ||
    !equalSecret(
      request.headers.get("authorization") ?? "",
      "Bearer " + expected,
    )
  )
    throw new ExpectedError("not_authorized", 401);
}
function snowflake(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{17,20}$/.test(value);
}

export function backendHandler(service: ApprovalService) {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/health" && request.method === "GET")
        return json({
          ok: true,
          inbox: service.store.db
            .query(
              "SELECT COUNT(*) AS pending, COALESCE(MAX(attempts),0) AS maxAttempts FROM inbox WHERE done=0",
            )
            .get(),
        });
      if (url.pathname === "/oauth/start" && request.method === "GET") {
        const result = service.start(url.searchParams.get("ticket") ?? "");
        return new Response(null, {
          status: 302,
          headers: {
            Location: result.url,
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "Set-Cookie":
              "__Host-approval=" +
              result.browser +
              "; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=300",
          },
        });
      }
      if (url.pathname === "/oauth/callback" && request.method === "GET") {
        const browser =
          request.headers
            .get("cookie")
            ?.split(";")
            .map((x) => x.trim())
            .find((x) => x.startsWith("__Host-approval="))
            ?.split("=")[1] ?? "";
        await service.callback(
          url.searchParams.get("state") ?? "",
          url.searchParams.get("code") ?? "",
          browser,
        );
        return new Response(
          "GitHub linked. Return to Discord to review a release.",
          {
            headers: {
              "Content-Type": "text/plain",
              "Cache-Control": "no-store",
              "Referrer-Policy": "no-referrer",
              "Content-Security-Policy":
                "default-src 'none'; frame-ancestors 'none'",
              "Set-Cookie":
                "__Host-approval=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0",
            },
          },
        );
      }
      if (url.pathname === "/internal/github" && request.method === "POST") {
        bearer(request, service.config.relayToken);
        const event = request.headers.get("x-github-event") ?? "";
        const delivery = request.headers.get("x-github-delivery") ?? "";
        if (!supported.has(event) || !/^[a-zA-Z0-9-]{1,100}$/.test(delivery))
          throw new ExpectedError("invalid_delivery", 400);
        const raw = await boundedBody(request);
        if (
          !validSignature(
            raw,
            request.headers.get("x-hub-signature-256"),
            service.config.webhookSecret,
          )
        )
          throw new ExpectedError("invalid_signature", 401);
        const payload = new TextDecoder("utf-8", { fatal: true }).decode(raw);
        JSON.parse(payload);
        service.enqueue(delivery, event, payload);
        return json({ accepted: true }, 202);
      }
      if (!url.pathname.startsWith("/internal/"))
        return json({ error: "not_found" }, 404);
      bearer(request, service.config.botToken);
      if (url.pathname === "/internal/events" && request.method === "GET") {
        const client = url.searchParams.get("client") ?? "";
        if (!/^[a-f0-9-]{36}$/.test(client) || !service.store.claim(client))
          throw new ExpectedError("consumer_busy");
        let stop = (_close = true) => {};
        const abort = () => stop();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            let closed = false;
            let initial = true;
            const emit = () => {
              if (closed) return;
              // Refresh pending cards after a bot update, even if an older renderer acknowledged them.
              const cards = new Map(
                service.store.changed().map((card) => [card.id, card]),
              );
              if (initial) {
                for (const card of service.store
                  .cards()
                  .filter((card) => card.phase === "pending"))
                  cards.set(card.id, card);
                initial = false;
              }
              controller.enqueue(
                encoder.encode(
                  "data: " + JSON.stringify([...cards.values()]) + "\n\n",
                ),
              );
            };
            const heartbeat = setInterval(() => {
              if (!service.store.claim(client)) {
                stop();
                return;
              }
              controller.enqueue(encoder.encode(": heartbeat\n\n"));
            }, 15000);
            stop = (close = true) => {
              if (closed) return;
              closed = true;
              clearInterval(heartbeat);
              service.listeners.delete(emit);
              service.store.release(client);
              request.signal.removeEventListener("abort", abort);
              if (close) controller.close();
            };
            service.listeners.add(emit);
            request.signal.addEventListener("abort", abort, { once: true });
            emit();
          },
          cancel() {
            stop(false);
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
          },
        });
      }
      if (request.method !== "POST") return json({ error: "not_found" }, 404);
      const body = JSON.parse(
        new TextDecoder().decode(await boundedBody(request, 16384)),
      );
      if (url.pathname === "/internal/ack") {
        if (
          !snowflake(body.messageId) ||
          (body.threadMessageId && !snowflake(body.threadMessageId)) ||
          !Number.isSafeInteger(body.revision) ||
          body.revision < 0 ||
          typeof body.id !== "string" ||
          typeof body.client !== "string" ||
          !/^[a-f0-9-]{36}$/.test(body.client) ||
          !service.store.claim(body.client)
        )
          throw new ExpectedError("invalid_ack", 400);
        service.store.ack(
          body.id,
          body.revision,
          body.messageId,
          body.threadMessageId,
        );
        return json({ ok: true });
      }
      service.owner(body.actor);
      if (url.pathname === "/internal/link")
        return json({ url: service.link(body.actor) });
      if (url.pathname === "/internal/review")
        return json(
          await service.review(
            body.actor,
            body.id,
            body.revision,
            body.decision,
          ),
        );
      if (url.pathname === "/internal/decide") {
        if (typeof body.confirmation !== "string")
          throw new ExpectedError("invalid_confirmation", 400);
        await service.decide(body.actor, body.confirmation);
        return json({ ok: true });
      }
      return json({ error: "not_found" }, 404);
    } catch (err) {
      if (err instanceof ExpectedError)
        return json({ error: err.code }, err.status);
      if (err instanceof SyntaxError)
        return json({ error: "invalid_json" }, 400);
      // Do not expose or log upstream response bodies, OAuth codes or tokens.
      return json({ error: "request_failed" }, 500);
    }
  };
}

export function relayHandler(config: { secret: string }, queue: RelayQueue) {
  return async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET")
      return json({ ok: true, pending: queue.pending() });
    if (url.pathname !== "/github/webhook" || request.method !== "POST")
      return json({ error: "not_found" }, 404);
    try {
      const raw = await boundedBody(request);
      const signature = request.headers.get("x-hub-signature-256");
      if (!validSignature(raw, signature, config.secret))
        return json({ error: "invalid_signature" }, 401);
      const event = request.headers.get("x-github-event") ?? "";
      const delivery = request.headers.get("x-github-delivery") ?? "";
      if (!supported.has(event)) return json({ ignored: true }, 202);
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(delivery))
        return json({ error: "invalid_delivery" }, 400);
      queue.enqueue(delivery, event, signature!, raw);
      return json({ accepted: true }, 202);
    } catch {
      return json({ error: "delivery_not_persisted" }, 503);
    }
  };
}
