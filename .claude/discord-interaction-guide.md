# Discord.js Interaction Response Guide

## Initial Response (Required within 3 seconds)
- **`reply()`** - First response to any interaction (slash command, button, modal submit, etc.)
- **`deferReply()`** - Use when processing takes >3 seconds, shows "thinking..." indicator
- **`update()`** - (Button/Select/Modal submit from message) Updates the message containing the component
- **`deferUpdate()`** - (Button/Select/Modal submit from message) Acknowledge without visible change; use when processing takes >3 seconds and you want to edit the component's message afterward via `editReply()`

## Follow-up Messages
- **`followUp()`** - Send additional messages after initial response
- **`editReply()`** - Edit the initial response message (works after any defer or reply)

## Deleting Messages
- **`deleteReply()`** - Delete the initial response
- **`interaction.message.delete()`** - Delete the original message (for component interactions)

## Common Patterns

### Slash Command → Button → Update
```ts
// 1. Slash command sends message with button
await interaction.reply({ content: "Click:", components: [button] });

// 2. Button click updates original message
await buttonInteraction.update({ content: "Clicked!", components: [] });
```

### Button → Modal → Edit original message
```ts
// 1. Button opens modal (consumes the button interaction)
await buttonInteraction.showModal(modal);

// 2. Await the modal submit inside the button handler
const submit = await buttonInteraction.awaitModalSubmit({ time: 5 * 60 * 1000, filter: ... });

// 3. Defer immediately before any async work (modal submit token expires in 3s)
await submit.deferUpdate();

// 4. Do async work...

// 5. Edit the original message (the one the button was on)
await submit.editReply({ content: "Done!" });
```

> Note: `submit.isFromMessage()` must be true (i.e. modal was opened from a button/select on a message, not from a slash command). Use `submit.reply()` for modals opened from slash commands.

### Long Processing with Defer
```ts
// 1. Defer immediately
await interaction.deferReply();

// 2. Do work...

// 3. Send actual response
await interaction.editReply({ content: "Done!" });
```

### Multiple Messages
```ts
// 1. Initial response
await interaction.reply({ content: "Processing..." });

// 2. Additional messages
await interaction.followUp({ content: "Step 1 complete" });
await interaction.followUp({ content: "Step 2 complete" });

// 3. Update original
await interaction.editReply({ content: "All done!" });
```

## Key Rules
- One initial response per interaction (reply/deferReply/update/deferUpdate)
- `update()` and `deferUpdate()` only work on component interactions (buttons/selects) and modal submits where `isFromMessage()` is true
- `editReply()` only works after any initial response (reply, deferReply, update, deferUpdate)
- `followUp()` requires an initial response first
- Component collectors can handle multiple interactions on same message

## Modal Custom IDs

### Always use a unique custom ID per modal open

Always append something unique to modal custom IDs so Discord never reuses state from a previous open:

```ts
// For new/add modals — timestamp-based, unique per open
const modalCustomId = `my-feature/add:${Date.now().toString(36)}`;

// For edit modals — hash of the entity being edited, stable across reopens of the same item
import { createHash } from "node:crypto";
const hash = createHash("sha256").update(entity.id).digest("hex").slice(0, 8);
const modalCustomId = `my-feature/edit:${hash}`;
```

Both approaches keep the ID well under Discord's 100-char limit (~29 chars for each pattern above).

**Why**: Modal dismissal fires **no event** — Discord handles it entirely client-side. The `awaitModalSubmit` collector on the server has no way to know the modal was closed, so it stays alive until its timeout. When the same modal is reopened with the same custom ID, the stale listener intercepts the new submit alongside the fresh one — both collectors resolve, both call `reply()`/`update()` on the same interaction, and the second one gets `DiscordAPIError[40060]: Interaction has already been acknowledged`. A unique ID per open prevents the stale collector from matching the new submit. The user sees no error — the first collector handles it correctly — but the second attempt throws to Sentry.

> Note: Client-side visual caching of modal text inputs by custom ID is **not confirmed** in Discord's documentation. The real issue is server-side listener collision. However, unique IDs solve both concerns simultaneously.

### Do not call `setValue("")` on text inputs to clear caches

Using unique modal custom IDs is the correct fix. `setValue("")` on a `TextInputBuilder` is redundant — the Discord API sends whatever `value` you set fresh each time the modal is shown, and there is no confirmed client-side cache that overrides it.

## Unconfirmed Behavior (needs verification)

> ⚠️ These are observations from production issues, not confirmed against Discord API docs.

### `update()` may fail on Components V2 messages (10062)

In `ScheduleConfigNewButtonHandler`, calling `submit.update()` (type 7 UPDATE_MESSAGE) from a modal submit returned `DiscordAPIError[10062]: Unknown interaction`, even though the modal was submitted well within the 3-second window.

The button was on a message sent with `MessageFlags.IsComponentsV2`. A similar handler (`ModLogReasonButtonHandler`) uses `interaction.update()` successfully, but its button is on a regular embed message (no `IsComponentsV2`).

**Workaround used**: `deferUpdate()` + `editReply()` (PATCH webhook endpoint) instead of `update()` (POST interaction callback). This resolved the issue.

**Unconfirmed**: Whether `IsComponentsV2` specifically causes this, or whether passing `flags: MessageFlags.IsComponentsV2` in the `update()` body is what Discord rejects, or some other cause entirely.