import type { PreviewMessage, PreviewRequest } from "./types";

export const MAX_TARGET_ROWS = 8;
export const MAX_CONTEXT_RUN = 2;

export interface MessageRow {
  kind: "message";
  message: PreviewMessage;
  isTarget: boolean;
  /** Identical consecutive target messages folded into this row. */
  count: number;
  firstAt: Date;
  lastAt: Date;
}

export type DividerRow =
  | { kind: "divider"; type: "context"; count: number; minutes: number }
  | { kind: "divider"; type: "earlier"; count: number; name: string };

export type LayoutRow = MessageRow | DividerRow;

export function isTargetMessage(
  message: PreviewMessage,
  targetUserId: string,
): boolean {
  return (
    message.author.id === targetUserId || message.triggeredById === targetUserId
  );
}

function sameContent(a: PreviewMessage, b: PreviewMessage): boolean {
  return (
    a.author.id === b.author.id &&
    a.content === b.content &&
    a.deleted === b.deleted &&
    a.automodFlagged === b.automodFlagged &&
    a.triggeredBy === b.triggeredBy &&
    a.triggeredById === b.triggeredById &&
    a.attachmentNames.length === b.attachmentNames.length &&
    a.attachmentNames.every((name, i) => name === b.attachmentNames[i])
  );
}

function collapseIdentical(
  messages: PreviewMessage[],
  targetUserId: string,
): MessageRow[] {
  const rows: MessageRow[] = [];
  for (const message of messages) {
    const isTarget = isTargetMessage(message, targetUserId);
    const prev = rows.at(-1);
    if (
      prev &&
      isTarget &&
      prev.isTarget &&
      sameContent(prev.message, message)
    ) {
      prev.count += 1;
      prev.lastAt = message.createdAt;
      continue;
    }
    rows.push({
      kind: "message",
      message,
      isTarget,
      count: 1,
      firstAt: message.createdAt,
      lastAt: message.createdAt,
    });
  }
  return rows;
}

function contextDivider(run: MessageRow[]): DividerRow {
  const first = run[0].firstAt.getTime();
  const last = run[run.length - 1].lastAt.getTime();
  return {
    kind: "divider",
    type: "context",
    count: run.reduce((sum, row) => sum + row.count, 0),
    minutes: Math.round((last - first) / 60_000),
  };
}

export function targetName(req: PreviewRequest): string {
  const own = req.messages.find((m) => m.author.id === req.targetUserId);
  if (own) {
    return own.author.displayName;
  }
  const triggered = req.messages.find(
    (m) => m.triggeredById === req.targetUserId && m.triggeredBy,
  );
  return triggered?.triggeredBy ?? "user";
}

function earlierDivider(req: PreviewRequest, count: number): DividerRow {
  return { kind: "divider", type: "earlier", count, name: targetName(req) };
}

/**
 * Picks the rows to draw: at most 8 target rows (newest kept), ≤2 context
 * messages around and between them, longer context runs folded into a
 * divider, identical consecutive target messages folded into one ×N row.
 */
export function selectRows(req: PreviewRequest): LayoutRow[] {
  const all = collapseIdentical(req.messages, req.targetUserId);
  const targetIndexes = all.flatMap((row, i) => (row.isTarget ? [i] : []));

  if (targetIndexes.length === 0) {
    const context = all.slice(-MAX_CONTEXT_RUN * 2);
    if (req.hiddenEarlierCount <= 0) {
      return context;
    }
    return [earlierDivider(req, req.hiddenEarlierCount), ...context];
  }

  let hiddenEarlier = Math.max(0, req.hiddenEarlierCount);
  const kept = targetIndexes.slice(-MAX_TARGET_ROWS);
  for (const i of targetIndexes.slice(0, -MAX_TARGET_ROWS)) {
    hiddenEarlier += all[i].count;
  }

  const firstKept = kept[0];
  const lastKept = kept[kept.length - 1];
  const rows: LayoutRow[] = [];

  if (hiddenEarlier > 0) {
    rows.push(earlierDivider(req, hiddenEarlier));
  }

  const previousTarget = targetIndexes.filter((i) => i < firstKept).at(-1);
  const leadStart = Math.max(
    previousTarget === undefined ? 0 : previousTarget + 1,
    firstKept - MAX_CONTEXT_RUN,
  );
  rows.push(...all.slice(leadStart, firstKept));

  for (let k = 0; k < kept.length; k++) {
    const index = kept[k];
    rows.push(all[index]);

    if (k === kept.length - 1) {
      break;
    }
    const run = all.slice(index + 1, kept[k + 1]);
    if (run.length <= MAX_CONTEXT_RUN) {
      rows.push(...run);
    } else {
      rows.push(run[0], contextDivider(run.slice(1, -1)), run[run.length - 1]);
    }
  }

  rows.push(...all.slice(lastKept + 1, lastKept + 1 + MAX_CONTEXT_RUN));
  return rows;
}
