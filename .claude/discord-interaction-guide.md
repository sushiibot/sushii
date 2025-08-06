# Discord.js Interaction Response Guide

## Initial Response (Required within 3 seconds)
- **`reply()`** - First response to any interaction (slash command, button, etc.)
- **`deferReply()`** - Use when processing takes >3 seconds, shows "thinking..."
- **`update()`** - (Button/Select only) Updates the message containing the component

## Follow-up Messages
- **`followUp()`** - Send additional messages after initial response
- **`editReply()`** - Edit the initial response message

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
- One initial response per interaction (reply/deferReply/update)
- `update()` only works on component interactions (buttons/selects)
- `editReply()` only works after reply/deferReply
- `followUp()` requires initial response first
- Component collectors can handle multiple interactions on same message