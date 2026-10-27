# Discord interaction responses

- Respond directly by default: `reply()` for commands, `update()` for buttons, selects and modal submits from a message. Discord shows the click loading until that response arrives.
- Database CRUD is never a reason to defer. Config reads, a few writes and a re-render finish well inside 3 seconds.
- Defer (`deferReply()` / `deferUpdate()`) only for genuinely long-running work: external HTTP or AI calls, image processing, fetching many members, messages or guilds, or bulk Discord actions.
- `deferUpdate()` as a terminal ack with no later edit is allowed when there's nothing to render; say so in the comment: `// defer: ack-only, <why nothing to render>`.
- Every defer needs a `// defer: <why this is slow, or "ack-only, <why nothing to render>">` comment on the line above it. `scripts/check-defer.ts` enforces this in the pre-commit hook and CI.
- Details and patterns: `.claude/discord-interaction-guide.md`.
