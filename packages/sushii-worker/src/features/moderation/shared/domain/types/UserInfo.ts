export interface UserInfo {
  id: string;
  username: string;
  avatarURL: string;
  createdAt: Date;
  joinedAt: Date | null;
  isBot: boolean;
}
