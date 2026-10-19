import { describe, expect, mock, test } from "bun:test";
import type { User } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pino from "pino";
import { Err, Ok } from "ts-results";

import type * as schema from "@/infrastructure/database/schema";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import { BanAction } from "../../shared/domain/entities/ModerationAction";
import type { ModerationCase } from "../../shared/domain/entities/ModerationCase";
import { ModerationTarget } from "../../shared/domain/entities/ModerationTarget";
import type { PermissionValidationService } from "../../shared/domain/services/PermissionValidationService";
import type { TimeoutDetectionService } from "../../shared/domain/services/TimeoutDetectionService";
import type { ModerationExecutionPipeline } from "./ModerationExecutionPipeline";
import {
  ModerationService,
  UNEXPECTED_TARGET_ERROR,
} from "./ModerationService";

const GUILD_ID = "guild-123";

function makeUser(id: string): User {
  return { id, tag: `user-${id}`, username: `user-${id}` } as unknown as User;
}

function makeService(execute: ModerationExecutionPipeline["execute"]) {
  const permissionService = {
    canTargetUser: mock(() => Promise.resolve(Ok(true))),
  } as unknown as PermissionValidationService;

  const timeoutDetectionService = {
    determineTimeoutActionType: mock((actionType) => actionType),
  } as unknown as TimeoutDetectionService;

  const guildConfigRepository = {
    findByGuildId: mock(() =>
      Promise.resolve(GuildConfig.createDefault(GUILD_ID)),
    ),
  } as unknown as GuildConfigRepository;

  const pipeline = {
    execute: mock(execute),
  } as unknown as ModerationExecutionPipeline;

  return new ModerationService(
    {} as NodePgDatabase<typeof schema>,
    permissionService,
    timeoutDetectionService,
    pipeline,
    guildConfigRepository,
    pino({ level: "silent" }),
  );
}

describe("ModerationService.executeAction", () => {
  test("isolates an unexpected failure to its target and continues the batch", async () => {
    const okCase = { caseId: "2" } as ModerationCase;
    const service = makeService((_action, _type, target) => {
      if (target.id === "bad") {
        return Promise.reject(new Error("connection lost"));
      }

      return Promise.resolve(Ok(okCase));
    });

    const action = new BanAction(
      GUILD_ID,
      makeUser("executor"),
      null,
      null,
      "unspecified",
    );

    const results = await service.executeAction(action, [
      new ModerationTarget(makeUser("bad"), null),
      new ModerationTarget(makeUser("good"), null),
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].err).toBe(true);
    expect(results[0].val).toBe(UNEXPECTED_TARGET_ERROR);
    expect(results[0].val).not.toContain("connection lost");
    expect(results[1].ok).toBe(true);
    expect(results[1].val).toBe(okCase);
  });

  test("passes business errors through unchanged", async () => {
    const service = makeService(() =>
      Promise.resolve(Err("User is not banned")),
    );

    const action = new BanAction(
      GUILD_ID,
      makeUser("executor"),
      null,
      null,
      "unspecified",
    );

    const [result] = await service.executeAction(action, [
      new ModerationTarget(makeUser("target"), null),
    ]);

    expect(result.err).toBe(true);
    expect(result.val).toBe("User is not banned");
  });
});
