export interface PreviewAuthor {
  id: string;
  /** nick → global_name → username, chosen by the caller */
  displayName: string;
  memberAvatarHash: string | null;
  userAvatarHash: string | null;
  /** "0" for new usernames */
  discriminator: string;
  isApp: boolean;
}

export interface PreviewMessage {
  id: string;
  author: PreviewAuthor;
  createdAt: Date;
  /** Raw Discord markdown; mentions are drawn as generic pills, never looked up. */
  content: string;
  attachmentNames: string[];
  deleted: boolean;
  automodFlagged: boolean;
  /** Display name of the member who triggered an app response. */
  triggeredBy?: string;
  /** Id of the member who triggered an app response. */
  triggeredById?: string;
}

export interface PreviewRequest {
  guildId: string;
  channelName: string;
  /** e.g. "18:20 – 18:31 · last 10 of 214 from spambot" */
  subtitle: string;
  /** Messages from this user (or triggered by them) are highlighted. */
  targetUserId: string;
  /** Target messages + nearby context, oldest first. */
  messages: PreviewMessage[];
  /** Target messages beyond the cap, for the divider. */
  hiddenEarlierCount: number;
}

export interface SuggestionPreviewRenderer {
  render(
    req: PreviewRequest,
  ): Promise<{ png: Buffer; width: number; height: number }>;
}

/** Too many previews in flight; callers should send the suggestion without an image. */
export class PreviewRendererBusyError extends Error {
  constructor() {
    super("Preview renderer busy");
    this.name = "PreviewRendererBusyError";
  }
}
