export interface ReasonTemplate {
  id: string;
  guildId: string;
  shortcut: string | null;
  content: string;
  contentKey: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date | null;
  useCount: number;
  lastUsedAt: Date | null;
}
