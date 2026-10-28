import { randomUUID } from "node:crypto";
import { z } from "zod";

export const candidateSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  createdAt: z.number().int().positive(),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  repositoryId: z.number().int().positive(),
  environment: z.string().min(1).max(100),
  environmentId: z.union([
    z.number().int().positive(),
    z.string().regex(/^release:[a-z0-9][a-z0-9-]*$/),
  ]),
  runId: z.number().int().positive(),
  runAttempt: z.number().int().positive(),
  sha: z.string().regex(/^[a-f0-9]{40}$/),
  previousSha: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .optional(),
  label: z.string().max(100),
  channelId: z.string().regex(/^[0-9]{17,20}$/),
  runUrl: z.url(),
  phase: z.enum([
    "pending",
    "deciding",
    "approved",
    "rejected",
    "deploying",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  messageId: z
    .string()
    .regex(/^[0-9]{17,20}$/)
    .optional(),
  threadMessageId: z
    .string()
    .regex(/^[0-9]{17,20}$/)
    .optional(),
  detail: z.string().max(200),
});
export type Candidate = z.infer<typeof candidateSchema>;
export class ApprovalError extends Error {
  constructor(readonly code: string) {
    super("Approval service: " + code);
  }
}
export class ApprovalClient {
  readonly consumerId = randomUUID();
  constructor(
    readonly baseUrl: string,
    private readonly token: string,
  ) {
    const url = new URL(baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error("Invalid private approval service URL");
  }
  async post(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(25000),
      headers: {
        Authorization: "Bearer " + this.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      const code = z
        .object({ error: z.string().regex(/^[a-z_]+$/) })
        .safeParse(result);
      if (code.success) throw new ApprovalError(code.data.error);
      throw new Error("Approval service request failed");
    }
    return result;
  }
  async review(actor: string, id: string, revision: number, decision: string) {
    return z
      .object({
        confirmation: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        card: candidateSchema,
      })
      .parse(
        await this.post("/internal/review", { actor, id, revision, decision }),
      );
  }
  async link(actor: string) {
    return z
      .object({ url: z.url() })
      .parse(await this.post("/internal/link", { actor })).url;
  }
  async *events(signal: AbortSignal): AsyncGenerator<Candidate[]> {
    const url = new URL("/internal/events", this.baseUrl);
    url.searchParams.set("client", this.consumerId);
    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + this.token },
      signal,
      redirect: "error",
    });
    if (!response.ok || !response.body)
      throw new Error("Approval event stream unavailable");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 2 * 1024 * 1024)
          throw new Error("Approval event frame too large");
        let split: number;
        while ((split = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          if (frame.startsWith("data: "))
            yield z.array(candidateSchema).parse(JSON.parse(frame.slice(6)));
          else yield []; // Heartbeats also let the consumer notice a blue/green handover.
        }
      }
    } finally {
      await reader.cancel();
    }
  }
}
