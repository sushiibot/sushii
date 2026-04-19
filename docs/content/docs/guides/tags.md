---
title: Tags Guide
description: How to create and use custom commands with tags
---

## Getting Started

Tags are custom commands that let you create quick responses for frequently used
messages. They're perfect for storing common answers, server rules, helpful
links, or any content you want to quickly access with a simple command.

## Command Overview

The tag system uses separate commands to allow for organization and separation
for permissions.

- **`/t`**: Quick tag usage
- **`/tag`**: Browse and discover tags
- **`/tag-add`**: Create new tags
- **`/tag-edit`**: Edit your own tags
- **`/tag-admin`**: Administrative operations (requires Manage Guild by default,
  or can be configured to allow other roles)

### Creating a Tag

Use the `/tag-add` command to create a new tag:

```
/tag-add name:welcome content:Welcome to our server! Please read the rules.
```

- **Name**: Must be 1-32 characters long (case-insensitive)
- **Content**: The text that will be displayed when the tag is used
- **Attachment**: Optional image attachment

You must provide either content, an attachment, or both.

Tags must be unique per server, and names are automatically converted to
lowercase.

### Using Tags

Once created, use tags with the `/t` command:

```
/t name:welcome
```

This short command makes it quick and easy to access your tags.

## Browsing & Discovering Tags

### Viewing Tag Information

Get detailed information about a tag with `/tag info`:

```
/tag info name:welcome
```

This shows:
- Tag content
- Creation date
- Owner
- Usage count
- Last used date

### Listing All Tags

View all server tags with pagination:

```
/tag list
```

### Searching Tags

Find specific tags using various filters:

```
/tag search name_starts_with:rule
/tag search name_contains:help
/tag search owner:@username
```

Search options:
- **name_starts_with**: Find tags beginning with specific text
- **name_contains**: Find tags containing specific text
- **owner**: Find tags created by a specific user

**Note:** You cannot combine `name_starts_with` and `name_contains` in the same search.

### Random Tags

Get a random tag, optionally with filters:

```
/tag random
/tag random name_starts_with:fun
/tag random owner:@username
```

## Editing Tags

You can only edit tags you own, or any tag if you have the "Manage Guild"
permission.

### Interactive Edit Interface

Use `/tag-edit` to open an interactive editing interface:

```
/tag-edit name:welcome
```

This provides buttons to:
- **Edit Content**: Modify the tag's text content via a modal
- **Rename**: Change the tag's name via a modal  
- **Delete**: Remove the tag entirely with confirmation

The interactive interface times out after a period of inactivity for security.

## Permissions

### Permission Levels

**Everyone (Default)**
- Use tags with `/t`
- Browse tags with `/tag` commands

**Tag Creators** (Default everyone permission, configurable in integration settings)
- Create tags with `/tag-add`
- Edit their own tags with `/tag-edit`
- All browsing and usage permissions

**Server Managers** (Default Manage Guild permission, configurable in integration settings)
- Edit or delete any tag in the server
- Use administrative commands
- All lower-level permissions

### Configuring Permissions

You can customize permissions for each command in Discord's Server Settings:

```
Server Settings > Integrations > [Bot Name] > Commands
```

For example:
- Restrict `/tag-add` to a "Content Creator" role
- Allow `/t` for @everyone
- Keep `/tag-admin` for moderators only

## Administrative Commands

### Delete Any Tag

```
/tag-admin delete name:tagname
```

### Bulk Delete User Tags

Remove all tags created by a specific user:

```
/tag-admin delete_user_tags user:@username
```

This is useful for moderation or when a user leaves the server.

## Features & Limitations

### Tag Names
- 1-32 characters long
- Case-insensitive (stored in lowercase)
- Must be unique per server
- Automatically converted to lowercase

### Content
- Can include text content and/or attachments
- Mentions are disabled in tag responses for safety
- Attachments are preserved with the tag

### Autocomplete
Commands with tag name inputs provide autocomplete suggestions based on:
- Existing tags in your server
- Tags you have permission to modify

### Usage Tracking
The bot tracks:
- How many times each tag has been used
- When each tag was last used
- Creation date and owner

## Common Use Cases

- **Server rules and guidelines**
- **Frequently asked questions**
- **Quick links and resources**
- **Welcome messages**
- **Role information**
- **Event announcements**
- **Troubleshooting steps**
- **Community resources**

## Tips

- Use `/tag search` to avoid creating duplicate tags
- The `/tag-edit` interface allows you to modify tags without remembering exact names
- Tags are server-specific - each Discord server has its own set of tags
- Set up permission roles to control who can create vs. use tags
- Use `/tag random` to discover tags you might have forgotten about
