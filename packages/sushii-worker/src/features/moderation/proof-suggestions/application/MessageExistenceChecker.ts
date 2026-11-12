export type MessageExistence = "exists" | "unknown_message" | "error";

export interface MessageExistenceChecker {
  /** Every id gets an entry. */
  checkMany(
    channelId: string,
    messageIds: string[],
  ): Promise<Map<string, MessageExistence>>;
}
