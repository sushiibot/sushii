import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "discord.js";

import Color from "@/utils/colors";

import type { GuildSnapshot } from "../../domain/GuildSnapshot";
import {
  DANGEROUS_PERMISSIONS,
  permissionLabel,
} from "../../domain/permissionCatalog";
import { type PlannedChange, permissionDiff } from "../../domain/planChange";
import { PERMISSION_AUDIT_CUSTOM_IDS } from "../customIds";
import { formatPermissions } from "./formatFinding";

const MAX_LISTED_CHANNELS = 5;

export interface FixPreviewOptions {
  change: PlannedChange;
  snapshot: GuildSnapshot;
  /** Why the runner or sushii can't make this change, if they can't. */
  refusal: string | null;
}

export function createFixPreview(options: FixPreviewOptions) {
  const { change, snapshot, refusal } = options;
  const container = new ContainerBuilder().setAccentColor(Color.Info);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `### ${previewTitle(change, snapshot)}`,
        ...previewBody(change, snapshot),
      ].join("\n"),
    ),
  );

  const warnings = previewWarnings(change, snapshot);
  if (warnings.length > 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(warnings.join("\n")),
    );
  }

  if (refusal) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Can't apply:** ${refusal}\n-# Make this change yourself in Server Settings, or ask someone who can.`,
      ),
    );
  }

  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(PERMISSION_AUDIT_CUSTOM_IDS.confirm)
        .setLabel("Confirm")
        .setStyle(ButtonStyle.Success)
        .setDisabled(refusal !== null),
      new ButtonBuilder()
        .setCustomId(PERMISSION_AUDIT_CUSTOM_IDS.cancel)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return wrap(container);
}

export type FixOutcome =
  | { ok: true; warning?: string }
  | { ok: false; message: string };

export function createFixResult(
  change: PlannedChange,
  snapshot: GuildSnapshot,
  outcome: FixOutcome,
) {
  const container = new ContainerBuilder().setAccentColor(
    outcome.ok ? Color.Success : Color.Error,
  );

  const content = outcome.ok
    ? [
        `### ✅ ${doneTitle(change, snapshot)}`,
        ...(outcome.warning ? [`⚠️ ${outcome.warning}`] : []),
        ...nextSteps(change, snapshot),
      ]
    : [`### Nothing was changed`, outcome.message];

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(content.join("\n")),
  );
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(PERMISSION_AUDIT_CUSTOM_IDS.back)
        .setLabel("Back to report")
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return wrap(container);
}

function roleRef(roleId: string, snapshot: GuildSnapshot): string {
  return roleId === snapshot.everyoneRoleId ? "@everyone" : `<@&${roleId}>`;
}

function targetRef(
  targetId: string,
  targetType: "role" | "member",
  snapshot: GuildSnapshot,
): string {
  return targetType === "role" ? roleRef(targetId, snapshot) : `<@${targetId}>`;
}

function isAdministratorReplacement(change: PlannedChange): boolean {
  return (
    change.kind === "set_role_permissions" &&
    permissionDiff(change.before, change.after).removed.includes(
      "Administrator",
    )
  );
}

function previewTitle(change: PlannedChange, snapshot: GuildSnapshot): string {
  switch (change.kind) {
    case "set_role_permissions":
      return isAdministratorReplacement(change)
        ? `Replace Administrator on ${roleRef(change.roleId, snapshot)}`
        : `Remove permissions from ${roleRef(change.roleId, snapshot)}`;
    case "edit_overwrite":
      return `Edit the override in <#${change.channelId}>`;
    case "delete_overwrite":
      return `Delete the override in <#${change.channelId}>`;
  }
}

function diffBlock(lines: string[]): string {
  return ["```diff", ...lines, "```"].join("\n");
}

function previewBody(change: PlannedChange, snapshot: GuildSnapshot): string[] {
  switch (change.kind) {
    case "set_role_permissions": {
      const { removed, added } = permissionDiff(change.before, change.after);
      const addedDangerous = added.filter((p) =>
        DANGEROUS_PERMISSIONS.includes(p),
      );
      const addedOther = added.length - addedDangerous.length;
      const noLongerGranted = removed.includes("Administrator")
        ? DANGEROUS_PERMISSIONS.filter(
            (p) => p !== "Administrator" && !added.includes(p),
          )
        : [];
      return [
        diffBlock([
          ...removed.map((p) => `- ${permissionLabel(p)}`),
          ...addedDangerous.map((p) => `+ ${permissionLabel(p)}`),
          ...(addedOther > 0
            ? [
                `+ ${addedOther} non-dangerous permissions (View Channel, Send Messages, …)`,
              ]
            : []),
        ]),
        ...(noLongerGranted.length > 0
          ? [`**No longer granted:** ${formatPermissions(noLongerGranted)}`]
          : []),
        `-# Affects ${change.affectedMembers.toLocaleString()} members.`,
      ];
    }

    case "edit_overwrite": {
      const { removed } = permissionDiff(change.beforeAllow, change.afterAllow);
      return [
        `Override for ${targetRef(change.targetId, change.targetType, snapshot)}:`,
        diffBlock(removed.map((p) => `- ${permissionLabel(p)}`)),
        "-# Removed permissions go back to whatever the role or server allows.",
      ];
    }

    case "delete_overwrite":
      return [
        `The override for ${roleRef(change.targetId, snapshot)} has no effect: the role has Administrator.`,
      ];
  }
}

function previewWarnings(
  change: PlannedChange,
  snapshot: GuildSnapshot,
): string[] {
  const warnings: string[] = [];

  if (
    change.kind === "set_role_permissions" &&
    change.channelLosses.length > 0
  ) {
    const listed = change.channelLosses
      .slice(0, MAX_LISTED_CHANNELS)
      .map(
        (loss) =>
          `<#${loss.channelId}>: ${formatPermissions(loss.permissions)}`,
      );
    const rest = change.channelLosses.length - listed.length;
    warnings.push(
      `⚠️ Administrator was bypassing channel overrides. Holders will lose:\n${listed.join("\n")}${rest > 0 ? `\n+${rest} more channels` : ""}`,
    );
  }

  if (snapshot.mfaRequired && change.kind !== "edit_overwrite") {
    warnings.push(
      "⚠️ This server requires 2FA for moderators. sushii can't check whether you have 2FA enabled.",
    );
  }

  return warnings;
}

function doneTitle(change: PlannedChange, snapshot: GuildSnapshot): string {
  switch (change.kind) {
    case "set_role_permissions":
      return `Updated ${roleRef(change.roleId, snapshot)}`;
    case "edit_overwrite":
      return `Updated the override in <#${change.channelId}>`;
    case "delete_overwrite":
      return `Deleted the override in <#${change.channelId}>`;
  }
}

/** No undo button: every change says how to reverse it by hand. */
function nextSteps(change: PlannedChange, snapshot: GuildSnapshot): string[] {
  switch (change.kind) {
    case "set_role_permissions": {
      const { removed } = permissionDiff(change.before, change.after);
      return [
        `-# To restore: Server Settings → Roles → ${roleRef(change.roleId, snapshot)}, and turn ${formatPermissions(removed)} back on.`,
      ];
    }
    case "edit_overwrite": {
      const { removed } = permissionDiff(change.beforeAllow, change.afterAllow);
      return [
        `-# To restore: <#${change.channelId}> → Edit Channel → Permissions, and allow ${formatPermissions(removed)} again.`,
      ];
    }
    case "delete_overwrite":
      return [
        "-# It had no effect, so nothing about who can do what has changed.",
      ];
  }
}

function wrap(container: ContainerBuilder) {
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 as const,
    allowedMentions: { parse: [] as [] },
  };
}
