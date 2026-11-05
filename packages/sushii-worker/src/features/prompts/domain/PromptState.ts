export type PromptScope = "guild" | "user";

/** Whose state a prompt is tracked against: a whole server, or one person across all servers. */
export interface PromptSubject {
  scope: PromptScope;
  id: bigint;
}

export interface PromptStateData {
  promptId: string;
  lastPromptedAt: Date | null;
  snoozeUntil: Date | null;
  dismissedAt: Date | null;
  completedAt: Date | null;
}
