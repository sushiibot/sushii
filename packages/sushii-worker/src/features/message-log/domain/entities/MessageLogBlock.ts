export class MessageLogBlock {
  constructor(
    public readonly guildId: string,
    public readonly channelId: string,
  ) {}

  static create(guildId: string, channelId: string): MessageLogBlock {
    return new MessageLogBlock(guildId, channelId);
  }
}
