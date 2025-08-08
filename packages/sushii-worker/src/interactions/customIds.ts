import type {
  MatchFunction,
  MatchResult,
  PathFunction} from "path-to-regexp";
import {
  compile,
  match,
} from "path-to-regexp";

import type { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";

enum Paths {
  RoleMenuButton = "/rolemenu/button/:roleId",
  RoleMenuSelect = "/rolemenu/select",
  RoleMenuAddRolesSelect = "/rolemenu/addRoles/select",
  ModerationAction = "/moderation/action/:actionType/:targetId",
  ModLogReason = "/modlog/reason/:caseId",
  ModLogDeleteReasonDM = "/modlog/rmDM/:caseId/:channelId/:messageId",
  ReasonConfirmButton = "reason_confirm/:userId/:buttonId/:action",
  SettingsToggleButton = "settings/toggle/:field/:newState",
  GiveawayEnterButton = "giveaway/enter",
}

export type SettingsToggleOptions =
  | "join_msg_enabled"
  | "leave_msg_enabled"
  | "log_mod_enabled"
  | "log_member_enabled"
  | "log_msg_enabled";

type PathParams<T extends Paths> = T extends Paths.RoleMenuButton
  ? {
      roleId: string;
    }
  : T extends Paths.RoleMenuSelect
    ? // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      {
        // No params
      }
    : T extends Paths.RoleMenuAddRolesSelect
      ? // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        {
          // /rolemenu addroles - No params since it is select menu
        }
      : T extends Paths.ModerationAction
        ? {
            actionType: ActionType;
            targetId: string;
          }
        : T extends Paths.ModLogReason
          ? {
              caseId: string;
            }
          : T extends Paths.ModLogDeleteReasonDM
            ? {
                caseId: string;
                channelId: string;
                messageId: string;
              }
            : T extends Paths.ReasonConfirmButton
              ? {
                  userId: string;
                  buttonId: string;
                  action: "override" | "empty" | "cancel";
                }
              : T extends Paths.SettingsToggleButton
                ? {
                    field: SettingsToggleOptions;
                    newState: string;
                  }
                : T extends Paths.GiveawayEnterButton
                  ? // eslint-disable-next-line @typescript-eslint/no-empty-object-type
                    {
                      // No params, uses guild ID and message ID from interaction
                    }
                  : never;

/**
 * Returns a function that returns null if the match fails or the params.
 *
 * @param fn
 * @returns
 */
function paramsOrNull<T extends object>(
  fn: MatchFunction<T>,
): (path: string) => MatchResult<T>["params"] | null {
  return (path: string) => {
    const result = fn(path);

    if (!result) {
      return null;
    }

    return result.params;
  };
}

interface CustomIDPath<T extends object> {
  path: string;
  match: MatchFunction<T>;
  matchParams: (path: string) => MatchResult<T>["params"] | null;
  compile: PathFunction<T>;
}

function createCustomID<T extends Paths>(path: T): CustomIDPath<PathParams<T>> {
  const m = match<PathParams<T>>(path);

  return {
    path,
    match: m,
    matchParams: paramsOrNull<PathParams<T>>(m),
    compile: compile<PathParams<T>>(path),
  };
}

const customIds = {
  roleMenuButton: createCustomID(Paths.RoleMenuButton),
  roleMenuSelect: createCustomID(Paths.RoleMenuSelect),
  roleMenuAddRolesSelect: createCustomID(Paths.RoleMenuAddRolesSelect),
  lookupButton: createCustomID(Paths.ModerationAction),
  modLogReason: createCustomID(Paths.ModLogReason),
  modLogDeleteReasonDM: createCustomID(Paths.ModLogDeleteReasonDM),
  reasonConfirmButton: createCustomID(Paths.ReasonConfirmButton),
  settingsToggleButton: createCustomID(Paths.SettingsToggleButton),
  giveawayEnterButton: createCustomID(Paths.GiveawayEnterButton),
};

export default customIds;
