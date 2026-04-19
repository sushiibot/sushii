---
title: Moderation Guide
description: How to use Sushii for moderation
---

sushii uses slash commands for moderation actions. This guide covers the
essential commands and recommendations for effective moderation.

## Setup

- Ensure you have a mod log channel set up and configured with `/settings modlog`

## Cases

Each moderation action has a **case number** (e.g., "case #987") that can be
found in the action logged in your configured moderation logs channel.

:::tip{icon="heart"}
All actions get logged in moderation logs, even if you don't use sushii
commands!

If you provided a reason in the native Discord moderation features
like timeouts, kicks, or bans, sushii will use that reason from the audit log.
:::

## Moderation Commands

Note that the `users` option can accept multiple user IDs (up to 25), so you can
perform actions on multiple users at once.

It may also be easier to use native Discord moderation features for some actions,
like timing out, kicking, or banning, as sushii will still log the action with
the provided reason.

The main cases where you would use sushii commands instead of native moderation
features are:
- When you already have a user ID copied
- If you want to perform an action on multiple users at once
- If you want to enable sending the reason via DMs for kicks or bans

### Warning & Timeout Commands

- **`/warn`** - Warn users
- **`/timeout`** - Time out a user
- **`/untimeout`** - Remove timeout from a user

### Removal Commands

- **`/kick`** - Kick a user
- **`/ban`** - Ban a user
- **`/unban`** - Unban a user

### When sushii DMs the user

- By default, sushii will only DM the user when performing warnings.
- For kicks and bans, you must explicitly add the `dm_reason` field to notify
  the user.
- Depending on the user's privacy settings, they may not receive DMs from the
  bot. sushii will show an error if it fails to DM the user.

### Case Management Commands

- **`/reason`** - Edit the reason for a moderation action
  - You can also edit reasons in sushii-logs using the buttons if no reason was
    set when performing the command
- **`/uncase`** - Delete a moderation action from a user's history and logs

### User Information Commands

- **`/note`** - Add a note to a user's sushii profile, private to moderators only.
- **`/history`** - Check a user's moderation history
