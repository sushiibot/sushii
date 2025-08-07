/**
 * Example additional information messages for moderation DMs.
 * These serve as placeholder examples for server-specific custom information
 * that moderators can configure to add context beyond the standard action message.
 *
 * Moderation DMs have the structure:
 * - Title: Always sent informational message (e.g., "You have been timed out from")
 * - Reason field: If configured to show reasons
 * - Duration field: For temporary actions
 * - Additional Information field: Custom server messages (these examples)
 */
export const MODERATION_DM_CUSTOM_EXAMPLES = {
  TIMEOUT_DM_TEXT:
    "Please review our server rules. Contact @ModMail if you have questions.",
  WARN_DM_TEXT:
    "Please review our server rules to avoid further action. Visit #rules for more information.",
  BAN_DM_TEXT: "You can appeal this ban at https://example.com/appeal",
} as const;
