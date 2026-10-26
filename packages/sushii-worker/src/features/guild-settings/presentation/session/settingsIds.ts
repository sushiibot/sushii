import type {
  SettingsEditTarget,
  SettingsTab,
  SettingsToggleTarget,
} from "../../domain/SettingsTargets";
import {
  SETTINGS_EDIT_TARGETS,
  SETTINGS_TABS,
  SETTINGS_TOGGLE_TARGETS,
} from "../../domain/SettingsTargets";

export {
  SETTINGS_EDIT_TARGETS,
  SETTINGS_TABS,
  SETTINGS_TOGGLE_TARGETS,
} from "../../domain/SettingsTargets";
export type {
  SettingsEditTarget,
  SettingsTab,
  SettingsToggleTarget,
} from "../../domain/SettingsTargets";

const PREFIX = "settings";
const NONCE_LENGTH = 8;

export type ParsedSettingsId =
  | { kind: "tab"; tab: SettingsTab }
  | { kind: "edit"; target: SettingsEditTarget }
  | { kind: "toggle"; target: SettingsToggleTarget }
  | { kind: "modal"; target: SettingsEditTarget; nonce: string };

const NONCE_PATTERN = new RegExp(`^[0-9a-z]{${NONCE_LENGTH}}$`);

function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
  let nonce = "";
  for (const byte of bytes) {
    nonce += (byte % 36).toString(36);
  }
  return nonce;
}

function isOneOf<T extends string>(
  values: readonly T[],
  value: string | undefined,
): value is T {
  return value !== undefined && (values as readonly string[]).includes(value);
}

export const settingsIds = {
  tab(tab: SettingsTab): string {
    return `${PREFIX}:tab:${tab}`;
  },
  edit(target: SettingsEditTarget): string {
    return `${PREFIX}:edit:${target}`;
  },
  toggle(target: SettingsToggleTarget): string {
    return `${PREFIX}:toggle:${target}`;
  },
  modal(target: SettingsEditTarget): string {
    return `${PREFIX}:modal:${target}:${generateNonce()}`;
  },
};

export function isSettingsId(id: string): boolean {
  return id.startsWith(`${PREFIX}:`);
}

export function parseSettingsId(id: string): ParsedSettingsId | null {
  const parts = id.split(":");
  if (parts[0] !== PREFIX) {
    return null;
  }

  const [, kind, value, nonce] = parts;

  if (kind === "modal") {
    if (
      parts.length !== 4 ||
      !isOneOf(SETTINGS_EDIT_TARGETS, value) ||
      nonce === undefined ||
      !NONCE_PATTERN.test(nonce)
    ) {
      return null;
    }
    return { kind, target: value, nonce };
  }

  if (parts.length !== 3) {
    return null;
  }

  if (kind === "tab" && isOneOf(SETTINGS_TABS, value)) {
    return { kind, tab: value };
  }
  if (kind === "edit" && isOneOf(SETTINGS_EDIT_TARGETS, value)) {
    return { kind, target: value };
  }
  if (kind === "toggle" && isOneOf(SETTINGS_TOGGLE_TARGETS, value)) {
    return { kind, target: value };
  }

  return null;
}
