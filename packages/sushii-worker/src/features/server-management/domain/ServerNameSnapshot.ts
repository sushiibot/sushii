export interface ServerNameSnapshot {
  guildId: string;
  name: string;
  savedBy: string;
  savedAt: Date;
}

export interface ServerNameSnapshotRepository {
  findByGuild(guildId: string): Promise<ServerNameSnapshot | null>;
  /** Keeps an existing snapshot so repeated renames still restore the original name. */
  saveIfAbsent(snapshot: Omit<ServerNameSnapshot, "savedAt">): Promise<void>;
  deleteByGuild(guildId: string): Promise<void>;
}
