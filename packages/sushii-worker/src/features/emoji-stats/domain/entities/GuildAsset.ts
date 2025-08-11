export class GuildAsset {
  constructor(
    public readonly id: string,
    public readonly guildId: string,
    public readonly name: string,
    public readonly type: "emoji" | "sticker",
  ) {}
}