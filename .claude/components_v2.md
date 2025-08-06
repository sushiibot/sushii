# Discord.js Components v2 Documentation

## Overview
Components v2 is Discord's new builder-based component system using `ContainerBuilder` to create structured, interactive messages with buttons, select menus, and modals.

## Core Concepts

### 1. Container-Based Architecture
Messages are built using `ContainerBuilder` which acts as the root component container:
```typescript
const container = new ContainerBuilder()
  .setAccentColor(Color.Info);
```

### 2. Component Types
- **TextDisplayBuilder**: Markdown-formatted text content
- **SectionBuilder**: Layout component for text with side-by-side accessories
- **SeparatorBuilder**: Visual dividers between sections
- **ActionRowBuilder**: Horizontal rows containing interactive components
- **ButtonBuilder**: Clickable buttons with custom IDs
- **ChannelSelectMenuBuilder**: Dropdown for channel selection
- **ModalBuilder**: Pop-up forms with text inputs

### 3. Message Structure
```typescript
return {
  components: [container],
  flags: MessageFlags.IsComponentsV2,  // Required flag
  allowedMentions: { parse: [] }
};
```

## Building Components

### Text Display
```typescript
const text = new TextDisplayBuilder()
  .setContent("## Section Title\nContent here");
container.addTextDisplayComponents(text);
```

### Section (Text with Side Accessory)
```typescript
// Section joins text content with an accessory component (button or thumbnail) on the side
const section = new SectionBuilder()
  .setId(1)  // Optional identifier
  .addComponents(
    new TextDisplayBuilder()
      .setContent("**Setting Name**\nDescription of the setting")
  )
  .setAccessory(
    new ButtonBuilder()
      .setCustomId("toggle_setting")
      .setLabel("Toggle")
      .setStyle(ButtonStyle.Primary)
  );

// Or with a thumbnail accessory on the side
const sectionWithThumbnail = new SectionBuilder()
  .addComponents(
    new TextDisplayBuilder()
      .setContent("**User Profile**\nLevel 25")
  )
  .setAccessory(
    new ThumbnailBuilder()
      .setUrl("https://example.com/avatar.png")
  );

// Sections support 1-3 text components (stacked vertically)
// The accessory appears to the side of all text components
const multiTextSection = new SectionBuilder()
  .addComponents(
    new TextDisplayBuilder().setContent("**Title**"),
    new TextDisplayBuilder().setContent("Description text"),
    new TextDisplayBuilder().setContent("Additional details")
  )
  .setAccessory(
    new ButtonBuilder()
      .setCustomId("action")
      .setLabel("Action")
      .setStyle(ButtonStyle.Secondary)
  );

container.addSectionComponents(section);
```

**Note**: 
- Sections are only available in messages with the `MessageFlags.IsComponentsV2` flag
- Text components (1-3) are stacked vertically within the section
- The accessory component (button or thumbnail) appears to the side of the text content

### Buttons
```typescript
const button = new ButtonBuilder()
  .setCustomId("unique_id")
  .setLabel("Click Me")
  .setStyle(ButtonStyle.Primary)
  .setDisabled(false);

const row = new ActionRowBuilder<ButtonBuilder>()
  .addComponents(button);
container.addActionRowComponents(row);
```

### Select Menus
```typescript
const select = new ChannelSelectMenuBuilder()
  .setCustomId("channel_select")
  .setPlaceholder("Choose a channel")
  .setChannelTypes(ChannelType.GuildText)
  .setMinValues(0)
  .setMaxValues(1)
  .setDefaultChannels(["123456789"]);

const row = new ActionRowBuilder<ChannelSelectMenuBuilder>()
  .addComponents(select);
container.addActionRowComponents(row);
```

### Modals
```typescript
const modal = new ModalBuilder()
  .setCustomId("text_modal")
  .setTitle("Edit Text");

const input = new TextInputBuilder()
  .setCustomId("text_input")
  .setLabel("Enter text")
  .setStyle(TextInputStyle.Paragraph)
  .setMaxLength(1000);

modal.addComponents(
  new ActionRowBuilder<TextInputBuilder>()
    .addComponents(input)
);
```

## Interaction Handling

### 1. Collector Pattern
```typescript
const msg = await interaction.reply(settingsMessage);
const collector = msg.createMessageComponentCollector({
  idle: 120000,  // 2 minutes timeout
  dispose: true
});

collector.on("collect", async (i) => {
  // Handle interaction
});

collector.on("end", async () => {
  // Disable components when expired
});
```

### 2. User Validation
```typescript
if (i.user.id !== interaction.user.id) {
  await i.reply({
    content: "These buttons aren't for you!",
    ephemeral: true
  });
  return;
}
```

### 3. Component Updates
```typescript
// Update original message with new components
await interaction.update({
  components: [updatedContainer],
  flags: MessageFlags.IsComponentsV2
});
```

### 4. Modal Handling
```typescript
// Show modal
await buttonInteraction.showModal(modal);

// Await submission
const submission = await buttonInteraction.awaitModalSubmit({
  time: 120000
});

// Process submission
const value = submission.fields.getTextInputValue("input_id");
await submission.update(updatedMessage);
```

## State Management

### Dynamic Updates
Components maintain state through:
1. **Database queries**: Fetch current config before building
2. **Collector scope**: Track current page/state in collector
3. **Rebuild on change**: Recreate container with new state

### Disabled State
```typescript
// Disable all components when collector ends
const disabledMessage = createSettingsMessage({
  ...options,
  disabled: true  // Propagates to all components
});
```

## Best Practices

1. **Custom IDs**: Use constants for consistency
   ```typescript
   const SETTINGS_CUSTOM_IDS = {
     TOGGLE_MOD_LOG: "settings_toggle_mod_log",
     SET_CHANNEL: "settings_set_channel"
   };
   ```

2. **Builder Functions**: Encapsulate complex components
   ```typescript
   function createToggleButton(enabled, name, customId, disabled) {
     return new ButtonBuilder()
       .setCustomId(customId)
       .setLabel(enabled ? `Disable ${name}` : `Enable ${name}`)
       .setStyle(enabled ? ButtonStyle.Secondary : ButtonStyle.Success)
       .setDisabled(disabled);
   }
   ```

3. **Page Navigation**: Use state tracking for multi-page interfaces
   ```typescript
   let currentPage: SettingsPage = "logging";
   // Update page based on navigation buttons
   ```

4. **Error Handling**: Wrap interactions in try-catch
   ```typescript
   try {
     await handleInteraction(i);
   } catch (err) {
     logger.error(err, "Failed to handle interaction");
   }
   ```

## Key Differences from Legacy Components

1. **Container-based**: All components added to ContainerBuilder
2. **Required flag**: Must specify `MessageFlags.IsComponentsV2`
3. **Builder pattern**: All components use builders (ButtonBuilder, etc.)
4. **Type safety**: Generic types for ActionRowBuilder<T>
5. **Modal integration**: Direct modal support with awaitModalSubmit

## Implementation Flow

1. **Build Message**: Create container with all components
2. **Send Reply**: Include IsComponentsV2 flag
3. **Create Collector**: Listen for interactions
4. **Handle Interactions**: Process based on customId
5. **Update Message**: Rebuild container with new state
6. **Cleanup**: Disable components on timeout