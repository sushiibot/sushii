import { DiscordAPIError, RESTJSONErrorCodes, Routes } from "discord.js";
import type { APIMessage, REST } from "discord.js";
import type { Logger } from "pino";

import type {
  MessageExistence,
  MessageExistenceChecker,
} from "../application/MessageExistenceChecker";

const LIST_LIMIT = 100;
const MAX_LIST_CALLS = 2;
const SINGLE_FETCH_CONCURRENCY = 5;

function compareSnowflakes(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export class DiscordMessageExistenceChecker implements MessageExistenceChecker {
  constructor(
    private readonly rest: REST,
    private readonly logger: Logger,
  ) {}

  async checkMany(
    channelId: string,
    messageIds: string[],
  ): Promise<Map<string, MessageExistence>> {
    const result = new Map<string, MessageExistence>();
    const failures: { err: unknown; messageId?: string }[] = [];
    let remaining = [...new Set(messageIds)].sort(compareSnowflakes);

    // A page of channel history is contiguous, so an id inside its span that isn't listed was deleted.
    for (let call = 0; call < MAX_LIST_CALLS && remaining.length > 1; call++) {
      const around = remaining[Math.floor(remaining.length / 2)];
      const listed = await this.listAround(channelId, around);
      if ("err" in listed) {
        // Single fetches below still classify each id.
        failures.push({ err: listed.err });
        break;
      }

      if (listed.messages.length === 0) {
        break;
      }

      const ids = new Set(listed.messages.map((m) => m.id));
      const sorted = [...ids].sort(compareSnowflakes);
      const min = BigInt(sorted[0]);
      const max = BigInt(sorted[sorted.length - 1]);

      remaining = remaining.filter((id) => {
        if (ids.has(id)) {
          result.set(id, "exists");
          return false;
        }

        const n = BigInt(id);
        if (n > min && n < max) {
          result.set(id, "unknown_message");
          return false;
        }

        return true;
      });
    }

    for (let i = 0; i < remaining.length; i += SINGLE_FETCH_CONCURRENCY) {
      const batch = remaining.slice(i, i + SINGLE_FETCH_CONCURRENCY);
      const states = await Promise.all(
        batch.map((id) => this.checkOne(channelId, id)),
      );
      batch.forEach((id, j) => {
        const state = states[j];
        if (typeof state === "string") {
          result.set(id, state);
        } else {
          result.set(id, "error");
          failures.push({ err: state.err, messageId: id });
        }
      });
    }

    if (failures.length > 0) {
      this.logger.warn(
        {
          err: failures[0].err,
          channelId,
          failedMessageIds: failures.flatMap((f) =>
            f.messageId ? [f.messageId] : [],
          ),
          listingFailed: failures.some((f) => !f.messageId),
        },
        "Could not check suggested proof messages",
      );
    }

    return result;
  }

  private async listAround(
    channelId: string,
    around: string,
  ): Promise<{ messages: APIMessage[] } | { err: unknown }> {
    try {
      const messages = (await this.rest.get(Routes.channelMessages(channelId), {
        query: new URLSearchParams({ around, limit: String(LIST_LIMIT) }),
      })) as APIMessage[];
      return { messages };
    } catch (err) {
      return { err };
    }
  }

  private async checkOne(
    channelId: string,
    messageId: string,
  ): Promise<Exclude<MessageExistence, "error"> | { err: unknown }> {
    try {
      await this.rest.get(Routes.channelMessage(channelId, messageId));
      return "exists";
    } catch (err) {
      if (
        err instanceof DiscordAPIError &&
        err.code === RESTJSONErrorCodes.UnknownMessage
      ) {
        return "unknown_message";
      }

      return { err };
    }
  }
}
