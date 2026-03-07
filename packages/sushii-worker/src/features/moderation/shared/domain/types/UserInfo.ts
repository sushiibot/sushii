export interface UserInfo {
  id: string;
  username: string;
  avatarURL: string;
  joinedAt: Date | null;
  isBot: boolean;
}
