export class EmojiStickerStat {
  constructor(
    public readonly time: Date,
    public readonly guildId: string,
    public readonly assetId: string,
    public readonly actionType: "message" | "reaction",
    public readonly count: number,
    public readonly countExternal: number,
  ) {}
}
