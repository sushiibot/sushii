import opentelemetry, { SpanStatusCode } from "@opentelemetry/api";
import type { GuildMember } from "discord.js";
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";

import { newModuleLogger } from "@/shared/infrastructure/logger";

import { computeLevelRoleDiff } from "./levelRoleDiff";

const tracer = opentelemetry.trace.getTracer("leveling");
const log = newModuleLogger("levelRoles");

/**
 * Best-effort: Discord failures are logged, not thrown.
 */
export async function applyLevelRoles(
  member: GuildMember,
  level: number,
  addRoleIds: readonly string[] | null,
  removeRoleIds: readonly string[] | null,
  logContext: Record<string, unknown>,
): Promise<void> {
  // Apply only the diff with single-role add/remove requests. Array forms of
  // roles.add/remove (and roles.set) send the full role list computed from a
  // possibly stale cache, which can revert concurrent role changes.
  const { toAdd, toRemove } = computeLevelRoleDiff(
    member.roles.cache.keys(),
    addRoleIds,
    removeRoleIds,
  );

  if (toAdd.length === 0 && toRemove.length === 0) {
    return;
  }

  const context = {
    ...logContext,
    guildId: member.guild.id,
    userId: member.id,
    newLevel: level,
    addRoleIds: toAdd,
    removeRoleIds: toRemove,
  };

  await tracer.startActiveSpan("leveling.roles.update", async (span) => {
    try {
      const reason = `Level role ${level}`;

      for (const roleId of toAdd) {
        await member.roles.add(roleId, reason);
      }

      for (const roleId of toRemove) {
        await member.roles.remove(roleId, reason);
      }

      log.debug(context, "Level role update");
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({ code: SpanStatusCode.ERROR });

      const message =
        err instanceof DiscordAPIError &&
        err.code === RESTJSONErrorCodes.MissingPermissions
          ? "Missing permissions to update member roles"
          : "Failed to update member roles";

      log.warn({ ...context, err }, message);
    } finally {
      span.end();
    }
  });
}
