import { Logger } from "pino";
import { Err, Ok, Result } from "ts-results";

import { ChannelService } from "../../shared/domain/services/ChannelService";
import { ChannelSlowmode } from "../../shared/domain/value-objects/ChannelSlowmode";

export interface SlowmodeUpdateResult {
  channelId: string;
  channelName: string;
  previousSlowmode: ChannelSlowmode;
  newSlowmode: ChannelSlowmode;
}

export class SlowmodeService {
  constructor(
    private readonly channelService: ChannelService,
    private readonly logger: Logger,
  ) {}

  async updateSlowmode(
    channelId: string,
    durationStr: string,
  ): Promise<Result<SlowmodeUpdateResult, string>> {
    this.logger.debug({ channelId, durationStr }, "Updating channel slowmode");

    // Parse and validate the duration
    const slowmodeResult = ChannelSlowmode.fromString(durationStr);
    if (slowmodeResult.err) {
      this.logger.warn(
        { channelId, durationStr, error: slowmodeResult.val },
        "Invalid slowmode duration",
      );
      return slowmodeResult;
    }

    const newSlowmode = slowmodeResult.val;

    // Check if channel exists
    const channelExistsResult = await this.channelService.exists(channelId);
    if (channelExistsResult.err) {
      return channelExistsResult;
    }

    if (!channelExistsResult.val) {
      return Err("Channel not found");
    }

    // Get current slowmode for comparison
    const currentSlowmodeResult =
      await this.channelService.getSlowmode(channelId);
    if (currentSlowmodeResult.err) {
      return currentSlowmodeResult;
    }

    const previousSlowmode = currentSlowmodeResult.val;

    // Get channel name for result
    const channelNameResult =
      await this.channelService.getChannelName(channelId);
    if (channelNameResult.err) {
      return channelNameResult;
    }

    const channelName = channelNameResult.val;

    // Update the slowmode
    const updateResult = await this.channelService.setSlowmode(
      channelId,
      newSlowmode,
    );
    if (updateResult.err) {
      this.logger.error(
        { channelId, error: updateResult.val },
        "Failed to update channel slowmode",
      );
      return updateResult;
    }

    this.logger.info(
      {
        channelId,
        channelName,
        previousSeconds: previousSlowmode.asSeconds,
        newSeconds: newSlowmode.asSeconds,
      },
      "Successfully updated channel slowmode",
    );

    return Ok({
      channelId,
      channelName,
      previousSlowmode,
      newSlowmode,
    });
  }

  async getCurrentSlowmode(
    channelId: string,
  ): Promise<
    Result<
      { channelId: string; channelName: string; slowmode: ChannelSlowmode },
      string
    >
  > {
    this.logger.debug({ channelId }, "Getting current channel slowmode");

    // Check if channel exists
    const channelExistsResult = await this.channelService.exists(channelId);
    if (channelExistsResult.err) {
      return channelExistsResult;
    }

    if (!channelExistsResult.val) {
      return Err("Channel not found");
    }

    // Get current slowmode
    const slowmodeResult = await this.channelService.getSlowmode(channelId);
    if (slowmodeResult.err) {
      return slowmodeResult;
    }

    // Get channel name
    const channelNameResult =
      await this.channelService.getChannelName(channelId);
    if (channelNameResult.err) {
      return channelNameResult;
    }

    return Ok({
      channelId,
      channelName: channelNameResult.val,
      slowmode: slowmodeResult.val,
    });
  }
}
