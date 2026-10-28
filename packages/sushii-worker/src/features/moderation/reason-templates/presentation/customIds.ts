const PREFIX = "reasonTemplates/";

export type PanelAction =
  | { action: "page"; page: number }
  | { action: "add" }
  | { action: "manage"; templateId: string; page: number }
  | { action: "edit"; templateId: string; page: number }
  | { action: "delete"; templateId: string; page: number }
  | { action: "deleteConfirm"; templateId: string; page: number };

const PAGE_RE = /^reasonTemplates\/page\/(\d{1,4})$/;
const ADD_ID = `${PREFIX}add`;
const TEMPLATE_ACTION_RE =
  /^reasonTemplates\/(manage|edit|delete|deleteConfirm)\/(\d{1,19})\/(\d{1,4})$/;

/** Disabled label button; never routed. */
export const PAGE_INFO_ID = `${PREFIX}pageinfo`;

export function buildPageId(page: number): string {
  return `${PREFIX}page/${page}`;
}

export function buildAddId(): string {
  return ADD_ID;
}

export function buildTemplateActionId(
  action: "manage" | "edit" | "delete" | "deleteConfirm",
  templateId: string,
  page: number,
): string {
  return `${PREFIX}${action}/${templateId}/${page}`;
}

export function parsePanelId(customId: string): PanelAction | null {
  if (customId === ADD_ID) {
    return { action: "add" };
  }

  const page = PAGE_RE.exec(customId);
  if (page) {
    return { action: "page", page: Number(page[1]) };
  }

  const templateAction = TEMPLATE_ACTION_RE.exec(customId);
  if (templateAction) {
    const action = templateAction[1] as
      | "manage"
      | "edit"
      | "delete"
      | "deleteConfirm";

    return {
      action,
      templateId: templateAction[2],
      page: Number(templateAction[3]),
    };
  }

  return null;
}

/** Fits MessageComponentHandler.customIDMatch; handlers re-parse with parsePanelId. */
export function matchPanelCustomId(
  customId: string,
): { path: string; index: number; params: object } | false {
  return parsePanelId(customId)
    ? { path: customId, index: 0, params: {} }
    : false;
}

function newNonce(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

/** New nonce per open so a stale collector from a dismissed form can't catch the next submit. */
export function buildModalId(
  kind: "addModal" | "editModal" | "saveModal",
): string {
  return `${PREFIX}${kind}/${newNonce()}`;
}
