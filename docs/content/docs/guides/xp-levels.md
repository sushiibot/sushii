---
title: XP & Levels
description: How the XP and leveling system works, and how to configure it
---

Members earn XP by sending messages — 5 XP per message, with a one-minute
cooldown. Constantly chatting for 20 minutes earns a maximum of 100 XP.

## Checking Rank & Leaderboard

```
/rank
/rank user:@member
```

Shows a member's current level, total XP, and their rank relative to the rest
of the server. Omit `user` to check your own.

```
/leaderboard
/leaderboard timeframe:week
```

Lists the most active members, filterable by `day`, `week`, `month`, or `all`
time. Useful for running activity-based events.

## Level Roles

The most useful part of the leveling system is automatically awarding roles
when members hit a milestone. Use this to gate channels, give perks, or
recognize long-time members without any manual work.

```
/levelrole new level:5 role:@Member
/levelrole new level:25 role:@Regular
/levelrole new level:100 role:@Veteran
/levelrole list
/levelrole delete level:25
```

Roles are additive — members keep all previously earned roles as they level up.
There's no cap on how many level roles you can configure.

## Blocking XP in Channels or Roles

By default, every message in every channel earns XP. If you have bot command
channels, spam channels, or roles that shouldn't be earning:

```
/xp block channel:#bot-commands
/xp block role:@Muted
/xp unblock channel:#bot-commands
```

Changes only affect messages going forward — existing XP isn't adjusted.
