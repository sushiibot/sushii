import type { Result } from "ts-results";

import type { ChannelSlowmode } from "../value-objects/ChannelSlowmode";

export interface ChannelService {
  /**
   * Set slowmode for a channel
   */
  setSlowmode(
    channelId: string,
    slowmode: ChannelSlowmode,
  ): Promise<Result<void, string>>;

  /**
   * Get current slowmode for a channel
   */
  getSlowmode(channelId: string): Promise<Result<ChannelSlowmode, string>>;

  /**
   * Check if channel exists and is accessible
   */
  exists(channelId: string): Promise<Result<boolean, string>>;

  /**
   * Get channel name for display purposes
   */
  getChannelName(channelId: string): Promise<Result<string, string>>;
}
