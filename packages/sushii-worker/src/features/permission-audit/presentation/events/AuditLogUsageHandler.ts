import type { Guild, GuildAuditLogsEntry } from "discord.js";
import { Events } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { PermissionUsageRecorder } from "../../application/PermissionUsageRecorder";
import { toAuditLogEntryInput } from "../../infrastructure/toAuditLogEntryInput";

export class AuditLogUsageHandler extends EventHandler<Events.GuildAuditLogEntryCreate> {
  readonly eventType = Events.GuildAuditLogEntryCreate;

  constructor(private readonly recorder: PermissionUsageRecorder) {
    super();
  }

  async handle(entry: GuildAuditLogsEntry, guild: Guild): Promise<void> {
    await this.recorder.recordAuditLogEntry(
      toAuditLogEntryInput(entry, guild.id),
    );
  }
}
