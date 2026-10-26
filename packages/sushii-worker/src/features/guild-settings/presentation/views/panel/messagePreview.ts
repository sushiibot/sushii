export interface MessagePreviewContext {
  userId: string;
  username: string;
  guildName: string;
  memberCount: number;
}

const MAX_PREVIEW_CHARS = 200;
const MAX_PREVIEW_LINES = 2;

const PLACEHOLDER_REGEX = /<username>|<mention>|<server>|<member_number>/g;

// Function replacer: `$` patterns in names stay literal and substituted values aren't re-scanned.
export function renderMessagePreview(
  template: string,
  context: MessagePreviewContext,
): string {
  return template.replace(PLACEHOLDER_REGEX, (placeholder) => {
    switch (placeholder) {
      case "<username>":
        return context.username;
      case "<mention>":
        return `<@${context.userId}>`;
      case "<server>":
        return context.guildName;
      case "<member_number>":
        return context.memberCount.toString();
      default:
        return placeholder;
    }
  });
}

const PARTIAL_TAG_REGEX = /<(?:@[!&]?|#|a?:|t:)[^<>\s]{0,64}$/;

function cutAtCharLimit(body: string): string {
  let out = body.slice(0, MAX_PREVIEW_CHARS);

  const lastCode = out.charCodeAt(out.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    out = out.slice(0, -1);
  }

  return out.replace(PARTIAL_TAG_REGEX, "");
}

function withEllipsis(body: string): string {
  let out = `${body.trimEnd()}…`;

  const fences = out.match(/```/g)?.length ?? 0;
  if (fences % 2 === 1) {
    out += "\n```";
  }

  return out;
}

// Every message on the panel shows as the same short quote; the full text is in the Edit modal.
export function quotedBlock(text: string): string {
  let lines = text.trim().split("\n");
  let truncated = false;
  if (lines.length > MAX_PREVIEW_LINES) {
    lines = lines.slice(0, MAX_PREVIEW_LINES);
    truncated = true;
  }

  let body = lines.join("\n");
  if (body.length > MAX_PREVIEW_CHARS) {
    body = cutAtCharLimit(body);
    truncated = true;
  }
  if (truncated) {
    body = withEllipsis(body);
  }

  return `> ${body.replace(/\n/g, "\n> ")}`;
}

export function quotedPreview(
  template: string,
  context: MessagePreviewContext,
): string {
  return quotedBlock(renderMessagePreview(template, context));
}
