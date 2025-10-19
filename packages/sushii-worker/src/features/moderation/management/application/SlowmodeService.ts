import type { GuildTextBasedChannel } from "discord.js";
import { DiscordAPIError } from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import { ChannelSlowmode } from "../../shared/domain/value-objects/ChannelSlowmode";

export interface SlowmodeUpdateResult {
  previousSlowmode: ChannelSlowmode;
  newSlowmode: ChannelSlowmode;
}

export class SlowmodeService {
  constructor(private readonly logger: Logger) {}

  async updateSlowmode(
    channel: GuildTextBasedChannel,
    durationStr: string,
  ): Promise<Result<SlowmodeUpdateResult, string>> {
    this.logger.debug(
      { channelId: channel.id, durationStr },
      "Updating channel slowmode",
    );

    // Parse and validate the duration
    const slowmodeResult = ChannelSlowmode.fromString(durationStr);
    if (slowmodeResult.err) {
      this.logger.warn(
        { channelId: channel.id, durationStr, error: slowmodeResult.val },
        "Invalid slowmode duration",
      );
      return slowmodeResult;
    }

    const newSlowmode = slowmodeResult.val;

    // Get current slowmode for comparison
    const previousSlowmodeResult = ChannelSlowmode.fromSeconds(
      channel.rateLimitPerUser || 0,
    );
    if (previousSlowmodeResult.err) {
      return Err(previousSlowmodeResult.val);
    }

    const previousSlowmode = previousSlowmodeResult.val;

    // Actually update the slowmode now
    try {
      await channel.edit({
        rateLimitPerUser: newSlowmode.asSeconds,
      });

      this.logger.info(
        {
          channelId: channel.id,
          channelName: channel.name,
          previousSeconds: previousSlowmode.asSeconds,
          newSeconds: newSlowmode.asSeconds,
        },
        "Successfully updated channel slowmode",
      );

      return Ok({
        previousSlowmode,
        newSlowmode,
      });
    } catch (error) {
      if (error instanceof DiscordAPIError) {
        this.logger.warn(
          { err: error, channelId: channel.id },
          "Discord API error updating slowmode",
        );
        return Err(`Failed to update slowmode: ${error.message}`);
      }

      this.logger.error(
        { err: error, channelId: channel.id },
        "Unexpected error updating slowmode",
      );
      return Err("Unexpected error updating slowmode");
    }
  }
}
