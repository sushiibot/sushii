import { expect, test } from "bun:test";

import type { CaseProof } from "@/features/moderation/shared/domain/entities/CaseProof";

import { formatProofContent, messageUrl } from "../domain/proofContent";
import { savedSuggestionLinks } from "./savedProof";
import { automodSuggestion } from "./testFixtures";

test("only reads saved links after the last separator, never URLs in rule names", () => {
  const labelUrl = messageUrl("1", "2", "3");
  const savedUrl = messageUrl("1", "2", "4");
  const content = formatProofContent(
    automodSuggestion({ ruleName: `Rule · ${labelUrl}` }),
    {
      links: [
        { url: savedUrl, source: "message", channelId: "2", messageIds: ["4"] },
      ],
      pending: [],
      skipped: [],
    },
  );
  expect(content).toStartWith(
    `🤖 AutoMod alert · Rule · ${labelUrl} · blocked in <#${automodSuggestion().blockedInChannelId}> · `,
  );
  expect(content?.length).toBeLessThanOrEqual(1000);
  expect(
    savedSuggestionLinks([{ source: "suggestion", content } as CaseProof]),
  ).toEqual([savedUrl]);
  expect(
    savedSuggestionLinks([{ source: "button", content } as CaseProof]),
  ).toEqual([]);
  expect(
    savedSuggestionLinks([
      { source: "suggestion", content: labelUrl } as CaseProof,
    ]),
  ).toEqual([]);
});

test("rows saved in the earlier AutoMod format still count as saved", () => {
  const savedUrl = messageUrl("1", "2", "4");
  const oldRow = `🛡️ AutoMod alert: Spam in <#2> · ${savedUrl}`;
  expect(
    savedSuggestionLinks([
      { source: "suggestion", content: oldRow } as CaseProof,
    ]),
  ).toEqual([savedUrl]);
});
