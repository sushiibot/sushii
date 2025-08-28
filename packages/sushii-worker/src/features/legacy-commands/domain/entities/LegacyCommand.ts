export interface LegacyCommandData {
  name: string;
  replacement: string;
}

export class LegacyCommand {
  constructor(
    public readonly name: string,
    public readonly replacement: string,
  ) {}

  static fromData(data: LegacyCommandData): LegacyCommand {
    return new LegacyCommand(data.name, data.replacement);
  }

  toData(): LegacyCommandData {
    return {
      name: this.name,
      replacement: this.replacement,
    };
  }
}
