import { PermissionsBitField } from "discord.js";

// Discord's UI labels these differently from their flag names.
const LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  ManageGuild: "Manage Server",
  ModerateMembers: "Timeout Members",
};

/** Readable names for a command's default_member_permissions; "0" is admin-only. */
export function permissionNames(defaultMemberPermissions: string): string[] {
  const bits = BigInt(defaultMemberPermissions);
  if (bits === 0n) {
    return ["Administrator"];
  }

  return new PermissionsBitField(bits)
    .toArray()
    .map(
      (name) =>
        LABEL_OVERRIDES[name] ?? name.replace(/([a-z])([A-Z])/g, "$1 $2"),
    );
}
