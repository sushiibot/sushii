import { sleep } from "bun";
import {
  AuditLogEvent,
  type Client,
  Events,
  type Guild,
  type GuildAuditLogsEntry,
} from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { MemberScreeningService } from "../../application/MemberScreeningService";
import type { ScreeningSettingsLookup } from "../../application/ScreeningSettingsLookup";

/** sushii's own buttons record the moderator; waiting lets that land first so the bot isn't credited. */
const OWN_ACTION_DELAY_MS = 5000;

export function screeningActionFor(entry: GuildAuditLogsEntry): string | null {
  switch (entry.action) {
    case AuditLogEvent.MemberBanAdd:
      return "banned";
    case AuditLogEvent.MemberKick:
      return "kicked";
    case AuditLogEvent.MemberUpdate: {
      const timeout = entry.changes.find(
        (c) => c.key === "communication_disabled_until",
      );
      return timeout?.new ? "timed out" : null;
    }
    default:
      return null;
  }
}

/** Needs the GuildModeration intent and View Audit Log; without them the event never fires. */
export class ScreeningAuditLogHandler extends EventHandler<Events.GuildAuditLogEntryCreate> {
  readonly eventType = Events.GuildAuditLogEntryCreate;

  constructor(
    private readonly service: MemberScreeningService,
    private readonly settings: Pick<ScreeningSettingsLookup, "find">,
    private readonly client: Client,
    private readonly wait: (ms: number) => Promise<unknown> = sleep,
  ) {
    super();
  }

  async handle(entry: GuildAuditLogsEntry, guild: Guild): Promise<void> {
    const action = screeningActionFor(entry);
    if (!action || !entry.targetId) {
      return;
    }

    const settings = await this.settings.find(guild.id);
    if (!settings) {
      return;
    }

    let by = entry.executorId;
    if (by !== null && by === this.client.user?.id) {
      await this.wait(OWN_ACTION_DELAY_MS);
      by = null;
    }

    await this.service.recordModAction(guild.id, entry.targetId, action, by);
  }
}
