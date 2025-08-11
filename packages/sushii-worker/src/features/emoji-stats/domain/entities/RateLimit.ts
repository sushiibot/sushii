export class RateLimit {
  constructor(
    public readonly userId: string,
    public readonly assetId: string,
    public readonly actionType: "message" | "reaction",
    public readonly lastUsed: Date,
  ) {}
}