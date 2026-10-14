import { describe, expect, test } from "bun:test";
import { PermissionFlagsBits } from "discord.js";

import {
  highestSeverity,
  permissionLabel,
  permissionsIn,
  severityOf,
} from "./permissionCatalog";

describe("permissionCatalog", () => {
  test("severity tiers", () => {
    expect(severityOf("Administrator")).toBe("critical");
    expect(severityOf("BanMembers")).toBe("high");
    expect(severityOf("ManageMessages")).toBe("medium");
    expect(severityOf("SendMessages")).toBe("low");
  });

  test("highest severity wins", () => {
    expect(highestSeverity(["ManageMessages", "ManageRoles"])).toBe("critical");
    expect(highestSeverity([])).toBe("low");
  });

  test("labels match Discord's UI", () => {
    expect(permissionLabel("ManageGuild")).toBe("Manage Server");
    expect(permissionLabel("ModerateMembers")).toBe("Timeout Members");
    expect(permissionLabel("BanMembers")).toBe("Ban Members");
  });

  test("permissionsIn reads a bitfield", () => {
    const bits =
      PermissionFlagsBits.BanMembers | PermissionFlagsBits.KickMembers;

    expect(
      permissionsIn(bits, ["BanMembers", "ManageRoles", "KickMembers"]),
    ).toEqual(["BanMembers", "KickMembers"]);
  });
});
