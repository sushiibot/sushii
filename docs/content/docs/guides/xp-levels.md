---
title: XP & Levels
description: How the XP and leveling system works, and how to configure it
---

<!-- source: packages/sushii-worker/src/features/leveling/application/UpdateUserXpService.ts#UpdateUserXpService.execute @caf0f3e7, packages/sushii-worker/src/features/leveling/domain/entities/UserLevel.ts#UserLevel.canGainXp @af0c7430 -->

Members earn XP by sending messages — 5 XP per message, with a one-minute
cooldown. Constantly chatting for 20 minutes earns a maximum of 100 XP.

## Checking Rank & Leaderboard

<!-- source: packages/sushii-worker/src/features/leveling/presentation/commands/RankCommand.ts#RankCommand @ffa4ebdc -->

```
/rank
/rank user:@member
```

Shows a member's current level, total XP, and their rank relative to the rest
of the server. Omit `user` to check your own.

<!-- source: packages/sushii-worker/src/features/leveling/presentation/commands/LeaderboardCommand.ts#LeaderboardCommand.command @2a28a932, packages/sushii-worker/src/features/leveling/domain/value-objects/TimeFrame.ts#timeFrameToString @66a8405b -->

```
/leaderboard
/leaderboard timeframe:Week
```

Lists the most active members. Set `timeframe` to **Day**, **Week**,
**Month**, or **All Time**. Useful for running activity-based events.

## Level Roles

Level roles hand out a role when a member reaches a level, so you can gate
channels or perks behind activity.

<!-- source: packages/sushii-worker/src/features/leveling/presentation/commands/LevelRoleCommand.ts#LevelRoleCommand.command @4c78ac2e, packages/sushii-worker/src/features/leveling/presentation/commands/LevelRoleCommand.ts#CommandName @8f68a1cc -->

```
/levelrole new role:@Member add_level:5
/levelrole new role:@Regular add_level:25 remove_level:100
/levelrole new role:@Veteran add_level:100
/levelrole list
/levelrole delete role:@Regular
```

<!-- source: packages/sushii-worker/src/features/leveling/domain/entities/LevelRole.ts#LevelRole.isValidLevelRange @9967e2b7, packages/sushii-worker/src/features/leveling/application/LevelRoleService.ts#LevelRoleService.createLevelRole @a0d4c320 -->

Members keep earlier level roles unless you set `remove_level`, which takes the
role away at a higher level. In the example above, @Regular is swapped for
@Veteran at level 100. There's no cap on how many level roles you can configure.

sushii's own role must sit above every level role, or it can't assign them.

## Blocking XP in Channels or Roles

<!-- source: packages/sushii-worker/src/features/leveling/presentation/commands/XpCommands.ts#XpGroupName @9b7f8b43, packages/sushii-worker/src/features/leveling/infrastructure/XpBlockRepositoryImpl.ts#XpBlockRepositoryImpl.findActiveBlocks @e03da0c8 -->

By default, every message in every channel earns XP. If you have bot command
channels, spam channels, or roles that shouldn't be earning:

```
/xp block channel channel:#bot-commands
/xp block role role:@Muted
/xp unblock channel channel:#bot-commands
```

Changes only affect messages going forward — existing XP isn't adjusted.
