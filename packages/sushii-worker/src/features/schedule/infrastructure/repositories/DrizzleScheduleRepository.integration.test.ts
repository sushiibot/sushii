import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pino from "pino";

import * as schema from "@/infrastructure/database/schema";
import {
  scheduleEventsInAppPublic,
  scheduleMessagesInAppPublic,
  schedulesInAppPublic,
} from "@/infrastructure/database/schema";
import { ScheduleEvent } from "@/features/schedule/domain/entities/ScheduleEvent";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";
import { DrizzleScheduleRepository } from "./DrizzleScheduleRepository";

const logger = pino({ level: "silent" });

// ── Seed helpers ───────────────────────────────────────────────────────────────

const GUILD = 1n;
const GUILD_B = 2n;
const CHANNEL = 100n;
const LOG_CHANNEL = 200n;
const USER = 999n;
const CAL = "cal@group.calendar.google.com";
const CAL_B = "calb@group.calendar.google.com";

async function seedSchedule(
  db: NodePgDatabase<typeof schema>,
  overrides: Partial<typeof schedulesInAppPublic.$inferInsert> = {},
) {
  const now = new Date();
  const row = {
    guildId: GUILD,
    calendarId: CAL,
    channelId: CHANNEL,
    logChannelId: LOG_CHANNEL,
    configuredByUserId: USER,
    calendarTitle: "Test Calendar",
    displayTitle: "Test Calendar",
    syncToken: null,
    pollIntervalSec: 120,
    nextPollAt: now,
    consecutiveFailures: 0,
    lastErrorAt: null,
    lastErrorReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  await db.insert(schedulesInAppPublic).values(row);
  return row;
}

function makeEvent(id: string, startUtc: Date): ScheduleEvent {
  return new ScheduleEvent(
    id,
    "Event " + id,
    startUtc,
    null,
    false,
    null,
    null,
    "confirmed",
  );
}

function makeAllDayEvent(id: string, startDate: string): ScheduleEvent {
  return new ScheduleEvent(id, "All Day " + id, null, startDate, true, null, null, "confirmed");
}

// ── Suite ──────────────────────────────────────────────────────────────────────

describe("DrizzleScheduleRepository (Integration)", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let repo: DrizzleScheduleRepository;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    repo = new DrizzleScheduleRepository(db, logger);
  });

  beforeEach(async () => {
    await db.delete(scheduleEventsInAppPublic);
    await db.delete(scheduleMessagesInAppPublic);
    await db.delete(schedulesInAppPublic);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  // ── ScheduleRepository ───────────────────────────────────────────────────────

  describe("upsert", () => {
    test("creates a new schedule and returns it", async () => {
      const now = new Date();
      const schedule = await repo.upsert({
        guildId: GUILD,
        calendarId: CAL,
        channelId: CHANNEL,
        logChannelId: LOG_CHANNEL,
        configuredByUserId: USER,
        calendarTitle: "Test Calendar",
        displayTitle: "Custom Name",
        nextPollAt: now,
      });

      expect(schedule.guildId).toBe(GUILD);
      expect(schedule.calendarId).toBe(CAL);
      expect(schedule.calendarTitle).toBe("Test Calendar");
      expect(schedule.displayTitle).toBe("Custom Name");
      expect(schedule.consecutiveFailures).toBe(0);
      expect(schedule.syncToken).toBeNull();
    });

    test("updates channel/title on conflict (same guildId + calendarId)", async () => {
      await seedSchedule(db, { channelId: CHANNEL, calendarTitle: "Old Title" });
      const now = new Date();
      const updated = await repo.upsert({
        guildId: GUILD,
        calendarId: CAL,
        channelId: 999n,
        logChannelId: LOG_CHANNEL,
        configuredByUserId: USER,
        calendarTitle: "New Title",
        displayTitle: "New Schedule",
        nextPollAt: now,
      });

      expect(updated.channelId).toBe(999n);
      expect(updated.calendarTitle).toBe("New Title");
      // upsert resets failures and syncToken
      expect(updated.consecutiveFailures).toBe(0);
      expect(updated.syncToken).toBeNull();
    });
  });

  describe("findAllDue", () => {
    test("returns schedules whose nextPollAt is in the past", async () => {
      const pastDate = new Date(Date.now() - 60_000);
      const futureDate = new Date(Date.now() + 60_000);
      await seedSchedule(db, { calendarId: CAL, channelId: CHANNEL, nextPollAt: pastDate });
      await seedSchedule(db, { calendarId: CAL_B, channelId: 101n, nextPollAt: futureDate });

      const due = await repo.findAllDue(new Date());
      expect(due).toHaveLength(1);
      expect(due[0].calendarId).toBe(CAL);
    });

    test("returns empty array when no schedules are due", async () => {
      await seedSchedule(db, { nextPollAt: new Date(Date.now() + 60_000) });
      expect(await repo.findAllDue(new Date())).toHaveLength(0);
    });

    test("includes schedules exactly at now", async () => {
      const now = new Date();
      await seedSchedule(db, { nextPollAt: now });
      expect(await repo.findAllDue(now)).toHaveLength(1);
    });
  });

  describe("findByChannel", () => {
    test("returns the schedule for the given channel", async () => {
      await seedSchedule(db);
      const result = await repo.findByChannel(GUILD, CHANNEL);
      expect(result?.calendarId).toBe(CAL);
    });

    test("returns null when no match", async () => {
      await seedSchedule(db);
      expect(await repo.findByChannel(GUILD, 999n)).toBeNull();
    });

    test("does not return schedules from a different guild", async () => {
      await seedSchedule(db);
      expect(await repo.findByChannel(GUILD_B, CHANNEL)).toBeNull();
    });
  });

  describe("findByCalendar", () => {
    test("returns the schedule for the given calendarId", async () => {
      await seedSchedule(db);
      expect((await repo.findByCalendar(GUILD, CAL))?.channelId).toBe(CHANNEL);
    });

    test("returns null when calendarId not in guild", async () => {
      await seedSchedule(db);
      expect(await repo.findByCalendar(GUILD, "other@group.calendar.google.com")).toBeNull();
    });
  });

  describe("findAllByGuild", () => {
    test("returns all schedules for the guild", async () => {
      await seedSchedule(db, { calendarId: CAL, channelId: CHANNEL });
      await seedSchedule(db, { calendarId: CAL_B, channelId: 101n });
      const all = await repo.findAllByGuild(GUILD);
      expect(all).toHaveLength(2);
    });

    test("does not include schedules from other guilds", async () => {
      await seedSchedule(db, { guildId: GUILD, calendarId: CAL, channelId: CHANNEL });
      await seedSchedule(db, { guildId: GUILD_B, calendarId: CAL_B, channelId: 101n });
      expect(await repo.findAllByGuild(GUILD)).toHaveLength(1);
    });
  });

  describe("delete", () => {
    test("removes the schedule from the database", async () => {
      await seedSchedule(db);
      await repo.delete(GUILD, CAL);
      expect(await repo.findByChannel(GUILD, CHANNEL)).toBeNull();
    });

    test("cascades to delete events for that schedule", async () => {
      await seedSchedule(db);
      await repo.upsertMany(GUILD, CAL, [makeEvent("e1", new Date())]);
      await repo.delete(GUILD, CAL);
      // After delete, events table should be empty
      const events = await db.select().from(scheduleEventsInAppPublic);
      expect(events).toHaveLength(0);
    });

    test("cascades to delete messages for that schedule", async () => {
      await seedSchedule(db);
      await repo.upsertMessage(GUILD, CAL, CHANNEL, 2024, 6, 0, 12345n, "hash1");
      await repo.delete(GUILD, CAL);
      const messages = await db.select().from(scheduleMessagesInAppPublic);
      expect(messages).toHaveLength(0);
    });
  });

  describe("updateSyncToken", () => {
    test("updates the syncToken and nextPollAt", async () => {
      await seedSchedule(db, { syncToken: null });
      const nextPoll = new Date(Date.now() + 120_000);
      await repo.updateSyncToken(GUILD, CAL, "token123", nextPoll);

      const updated = await repo.findByChannel(GUILD, CHANNEL);
      expect(updated?.syncToken).toBe("token123");
    });

    test("can clear the syncToken by setting it to null", async () => {
      await seedSchedule(db, { syncToken: "old-token" });
      await repo.updateSyncToken(GUILD, CAL, null, new Date());

      const updated = await repo.findByChannel(GUILD, CHANNEL);
      expect(updated?.syncToken).toBeNull();
    });
  });

  describe("recordFailure", () => {
    test("increments consecutiveFailures by 1", async () => {
      await seedSchedule(db, { consecutiveFailures: 2 });
      await repo.recordFailure(GUILD, CAL, "403 Forbidden", new Date(Date.now() + 240_000));

      const updated = await repo.findByChannel(GUILD, CHANNEL);
      expect(updated?.consecutiveFailures).toBe(3);
    });

    test("stores the error reason", async () => {
      await seedSchedule(db);
      await repo.recordFailure(GUILD, CAL, "Calendar not found", new Date());

      const updated = await repo.findByChannel(GUILD, CHANNEL);
      expect(updated?.lastErrorReason).toBe("Calendar not found");
    });

    test("sets lastErrorAt to a recent timestamp", async () => {
      const before = new Date();
      await seedSchedule(db);
      await repo.recordFailure(GUILD, CAL, "error", new Date());

      const updated = await repo.findByChannel(GUILD, CHANNEL);
      expect(updated?.lastErrorAt).toBeDefined();
      expect(updated!.lastErrorAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  describe("resetFailuresAndUpdateToken", () => {
    test("resets consecutiveFailures to 0", async () => {
      await seedSchedule(db, { consecutiveFailures: 5 });
      await repo.resetFailuresAndUpdateToken(GUILD, CAL, "new-token", new Date());

      const updated = await repo.findByChannel(GUILD, CHANNEL);
      expect(updated?.consecutiveFailures).toBe(0);
    });

    test("clears lastErrorAt and lastErrorReason", async () => {
      await seedSchedule(db, { lastErrorReason: "old error", consecutiveFailures: 3 });
      await repo.resetFailuresAndUpdateToken(GUILD, CAL, null, new Date());

      const updated = await repo.findByChannel(GUILD, CHANNEL);
      expect(updated?.lastErrorAt).toBeNull();
      expect(updated?.lastErrorReason).toBeNull();
    });

    test("updates the syncToken", async () => {
      await seedSchedule(db);
      await repo.resetFailuresAndUpdateToken(GUILD, CAL, "recovered-token", new Date());

      const updated = await repo.findByChannel(GUILD, CHANNEL);
      expect(updated?.syncToken).toBe("recovered-token");
    });
  });

  // ── ScheduleEventRepository ───────────────────────────────────────────────────

  describe("upsertMany", () => {
    test("inserts new events", async () => {
      await seedSchedule(db);
      const events = [
        makeEvent("e1", new Date("2024-06-10T10:00:00Z")),
        makeEvent("e2", new Date("2024-06-15T10:00:00Z")),
      ];
      await repo.upsertMany(GUILD, CAL, events);

      const rows = await db.select().from(scheduleEventsInAppPublic);
      expect(rows).toHaveLength(2);
    });

    test("updates existing events on conflict", async () => {
      await seedSchedule(db);
      const original = [makeEvent("e1", new Date("2024-06-10T10:00:00Z"))];
      await repo.upsertMany(GUILD, CAL, original);

      // Update same event with new summary
      const updated = new ScheduleEvent("e1", "Updated Title", new Date("2024-06-10T10:00:00Z"), null, false, null, null, "confirmed");
      await repo.upsertMany(GUILD, CAL, [updated]);

      const rows = await db.select().from(scheduleEventsInAppPublic);
      expect(rows).toHaveLength(1);
      expect(rows[0].summary).toBe("Updated Title");
    });

    test("is a no-op for empty array", async () => {
      await seedSchedule(db);
      await repo.upsertMany(GUILD, CAL, []);
      expect((await db.select().from(scheduleEventsInAppPublic))).toHaveLength(0);
    });
  });

  describe("deleteByIds", () => {
    test("removes only the specified events", async () => {
      await seedSchedule(db);
      await repo.upsertMany(GUILD, CAL, [
        makeEvent("e1", new Date()),
        makeEvent("e2", new Date()),
        makeEvent("e3", new Date()),
      ]);

      await repo.deleteByIds(GUILD, CAL, ["e1", "e3"]);
      const rows = await db.select().from(scheduleEventsInAppPublic);
      expect(rows).toHaveLength(1);
      expect(rows[0].eventId).toBe("e2");
    });

    test("is a no-op for empty ids array", async () => {
      await seedSchedule(db);
      await repo.upsertMany(GUILD, CAL, [makeEvent("e1", new Date())]);
      await repo.deleteByIds(GUILD, CAL, []);
      expect((await db.select().from(scheduleEventsInAppPublic))).toHaveLength(1);
    });
  });

  describe("replaceAllEvents", () => {
    test("atomically deletes all existing events and inserts new ones", async () => {
      await seedSchedule(db);
      await repo.upsertMany(GUILD, CAL, [makeEvent("old1", new Date()), makeEvent("old2", new Date())]);

      const newEvents = [makeEvent("new1", new Date()), makeEvent("new2", new Date())];
      await repo.replaceAllEvents(GUILD, CAL, newEvents);

      const rows = await db.select().from(scheduleEventsInAppPublic);
      expect(rows).toHaveLength(2);
      const ids = rows.map((r) => r.eventId).sort();
      expect(ids).toEqual(["new1", "new2"]);
    });

    test("results in empty table when called with empty array", async () => {
      await seedSchedule(db);
      await repo.upsertMany(GUILD, CAL, [makeEvent("e1", new Date())]);
      await repo.replaceAllEvents(GUILD, CAL, []);

      expect((await db.select().from(scheduleEventsInAppPublic))).toHaveLength(0);
    });

    test("does not affect events from other schedules", async () => {
      await seedSchedule(db, { guildId: GUILD, calendarId: CAL, channelId: CHANNEL });
      await seedSchedule(db, { guildId: GUILD, calendarId: CAL_B, channelId: 101n });
      await repo.upsertMany(GUILD, CAL_B, [makeEvent("other-event", new Date())]);

      await repo.replaceAllEvents(GUILD, CAL, [makeEvent("e1", new Date())]);

      const all = await db.select().from(scheduleEventsInAppPublic);
      const calBEvents = all.filter((r) => r.calendarId === CAL_B);
      expect(calBEvents).toHaveLength(1);
      expect(calBEvents[0].eventId).toBe("other-event");
    });
  });

  describe("findEventsByCalendar", () => {
    test("returns timed events within the date range", async () => {
      await seedSchedule(db);
      await repo.upsertMany(GUILD, CAL, [
        makeEvent("in-range", new Date("2024-06-15T10:00:00Z")),
        makeEvent("before", new Date("2024-05-31T23:59:59Z")),
        makeEvent("after", new Date("2024-07-01T00:00:00Z")),
      ]);

      const from = new Date("2024-06-01T00:00:00Z");
      const to = new Date("2024-07-01T00:00:00Z");
      const results = await repo.findEventsByCalendar(GUILD, CAL, from, to);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("in-range");
    });

    test("returns all-day events whose startDate falls within the range", async () => {
      await seedSchedule(db);
      await repo.upsertMany(GUILD, CAL, [
        makeAllDayEvent("in-range", "2024-06-15"),
        makeAllDayEvent("before", "2024-05-31"),
        makeAllDayEvent("after", "2024-07-01"),
      ]);

      const from = new Date("2024-06-01T00:00:00Z");
      const to = new Date("2024-07-01T00:00:00Z");
      const results = await repo.findEventsByCalendar(GUILD, CAL, from, to);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("in-range");
    });

    test("returns events sorted by start time ascending", async () => {
      await seedSchedule(db);
      await repo.upsertMany(GUILD, CAL, [
        makeEvent("e3", new Date("2024-06-20T10:00:00Z")),
        makeEvent("e1", new Date("2024-06-05T10:00:00Z")),
        makeEvent("e2", new Date("2024-06-10T10:00:00Z")),
      ]);

      const from = new Date("2024-06-01T00:00:00Z");
      const to = new Date("2024-07-01T00:00:00Z");
      const results = await repo.findEventsByCalendar(GUILD, CAL, from, to);

      expect(results.map((r) => r.id)).toEqual(["e1", "e2", "e3"]);
    });
  });

  describe("findRecentPastByGuild", () => {
    test("returns past events ordered most-recent-first", async () => {
      await seedSchedule(db);
      await repo.upsertMany(GUILD, CAL, [
        makeEvent("e1", new Date("2024-06-05T10:00:00Z")),
        makeEvent("e2", new Date("2024-06-10T10:00:00Z")),
        makeEvent("e3", new Date("2024-06-15T10:00:00Z")),
      ]);

      const before = new Date("2024-07-01T00:00:00Z");
      const results = await repo.findRecentPastByGuild(GUILD, before, 10);

      expect(results.map((r) => r.event.id)).toEqual(["e3", "e2", "e1"]);
    });

    test("respects the limit, returning the N most recent", async () => {
      await seedSchedule(db);
      await repo.upsertMany(GUILD, CAL, [
        makeEvent("e1", new Date("2024-06-05T10:00:00Z")),
        makeEvent("e2", new Date("2024-06-10T10:00:00Z")),
        makeEvent("e3", new Date("2024-06-15T10:00:00Z")),
      ]);

      const before = new Date("2024-07-01T00:00:00Z");
      const results = await repo.findRecentPastByGuild(GUILD, before, 2);

      expect(results).toHaveLength(2);
      expect(results.map((r) => r.event.id)).toEqual(["e3", "e2"]);
    });

    test("excludes future events", async () => {
      await seedSchedule(db);
      await repo.upsertMany(GUILD, CAL, [
        makeEvent("past", new Date("2024-06-05T10:00:00Z")),
        makeEvent("future", new Date("2024-08-01T10:00:00Z")),
      ]);

      const before = new Date("2024-07-01T00:00:00Z");
      const results = await repo.findRecentPastByGuild(GUILD, before, 10);

      expect(results).toHaveLength(1);
      expect(results[0].event.id).toBe("past");
    });

    test("does not return events from other guilds", async () => {
      await seedSchedule(db, { guildId: GUILD });
      await seedSchedule(db, { guildId: GUILD_B, calendarId: CAL_B, channelId: 101n });
      await repo.upsertMany(GUILD, CAL, [makeEvent("e1", new Date("2024-06-05T10:00:00Z"))]);
      await repo.upsertMany(GUILD_B, CAL_B, [makeEvent("e2", new Date("2024-06-06T10:00:00Z"))]);

      const before = new Date("2024-07-01T00:00:00Z");
      const results = await repo.findRecentPastByGuild(GUILD, before, 10);

      expect(results).toHaveLength(1);
      expect(results[0].event.id).toBe("e1");
    });

    test("returns all-day past events", async () => {
      await seedSchedule(db);
      await repo.upsertMany(GUILD, CAL, [
        makeAllDayEvent("past-allday", "2024-06-10"),
        makeAllDayEvent("future-allday", "2024-08-01"),
      ]);

      const before = new Date("2024-07-01T00:00:00Z");
      const results = await repo.findRecentPastByGuild(GUILD, before, 10);

      expect(results).toHaveLength(1);
      expect(results[0].event.id).toBe("past-allday");
    });
  });

  describe("findUpcomingByGuild", () => {
    test("returns events from all calendars in the guild", async () => {
      await seedSchedule(db, { calendarId: CAL, channelId: CHANNEL });
      await seedSchedule(db, { calendarId: CAL_B, channelId: 101n });
      await repo.upsertMany(GUILD, CAL, [makeEvent("e1", new Date("2024-06-15T10:00:00Z"))]);
      await repo.upsertMany(GUILD, CAL_B, [makeEvent("e2", new Date("2024-06-16T10:00:00Z"))]);

      const from = new Date("2024-06-01T00:00:00Z");
      const results = await repo.findUpcomingByGuild(GUILD, from, 100);

      expect(results).toHaveLength(2);
    });

    test("includes calendarTitle on each result", async () => {
      await seedSchedule(db, { calendarTitle: "My Calendar" });
      await repo.upsertMany(GUILD, CAL, [makeEvent("e1", new Date("2024-06-15T10:00:00Z"))]);

      const from = new Date("2024-06-01T00:00:00Z");
      const results = await repo.findUpcomingByGuild(GUILD, from, 100);

      expect(results[0].calendarTitle).toBe("My Calendar");
    });

    test("does not return events from other guilds", async () => {
      await seedSchedule(db, { guildId: GUILD });
      await seedSchedule(db, { guildId: GUILD_B, calendarId: CAL_B, channelId: 101n });
      await repo.upsertMany(GUILD, CAL, [makeEvent("e1", new Date("2024-06-15T10:00:00Z"))]);
      await repo.upsertMany(GUILD_B, CAL_B, [makeEvent("e2", new Date("2024-06-16T10:00:00Z"))]);

      const from = new Date("2024-06-01T00:00:00Z");
      const results = await repo.findUpcomingByGuild(GUILD, from, 100);

      expect(results).toHaveLength(1);
      expect(results[0].event.id).toBe("e1");
    });

    test("respects the limit parameter", async () => {
      await seedSchedule(db);
      await repo.upsertMany(GUILD, CAL, [
        makeEvent("e1", new Date("2024-06-10T10:00:00Z")),
        makeEvent("e2", new Date("2024-06-15T10:00:00Z")),
        makeEvent("e3", new Date("2024-06-20T10:00:00Z")),
      ]);

      const from = new Date("2024-06-01T00:00:00Z");
      const results = await repo.findUpcomingByGuild(GUILD, from, 2);

      expect(results).toHaveLength(2);
      expect(results[0].event.id).toBe("e1");
      expect(results[1].event.id).toBe("e2");
    });

    test("returns events far in the future with no upper date bound", async () => {
      await seedSchedule(db);
      await repo.upsertMany(GUILD, CAL, [
        makeEvent("near", new Date("2024-06-10T10:00:00Z")),
        makeEvent("far", new Date("2025-12-31T10:00:00Z")),
      ]);

      const from = new Date("2024-06-01T00:00:00Z");
      const results = await repo.findUpcomingByGuild(GUILD, from, 100);

      expect(results).toHaveLength(2);
      expect(results.map((r) => r.event.id)).toEqual(["near", "far"]);
    });
  });

  // ── ScheduleMessageRepository ─────────────────────────────────────────────────

  describe("upsertMessage", () => {
    test("inserts a new message record", async () => {
      await seedSchedule(db);
      await repo.upsertMessage(GUILD, CAL, CHANNEL, 2024, 6, 0, 12345n, "hash1");

      const messages = await repo.getMessages(GUILD, CAL, 2024, 6);
      expect(messages).toHaveLength(1);
      expect(messages[0].messageId).toBe(12345n);
      expect(messages[0].contentHash).toBe("hash1");
      expect(messages[0].isArchived).toBe(false);
    });

    test("updates messageId and hash on conflict", async () => {
      await seedSchedule(db);
      await repo.upsertMessage(GUILD, CAL, CHANNEL, 2024, 6, 0, 11111n, "hash-old");
      await repo.upsertMessage(GUILD, CAL, CHANNEL, 2024, 6, 0, 22222n, "hash-new");

      const messages = await repo.getMessages(GUILD, CAL, 2024, 6);
      expect(messages).toHaveLength(1);
      expect(messages[0].messageId).toBe(22222n);
      expect(messages[0].contentHash).toBe("hash-new");
    });
  });

  describe("getMessages", () => {
    test("returns messages ordered by messageIndex ascending", async () => {
      await seedSchedule(db);
      await repo.upsertMessage(GUILD, CAL, CHANNEL, 2024, 6, 2, 30000n, "h3");
      await repo.upsertMessage(GUILD, CAL, CHANNEL, 2024, 6, 0, 10000n, "h1");
      await repo.upsertMessage(GUILD, CAL, CHANNEL, 2024, 6, 1, 20000n, "h2");

      const messages = await repo.getMessages(GUILD, CAL, 2024, 6);
      expect(messages.map((m) => m.messageIndex)).toEqual([0, 1, 2]);
    });

    test("only returns messages for the given year+month", async () => {
      await seedSchedule(db);
      await repo.upsertMessage(GUILD, CAL, CHANNEL, 2024, 6, 0, 10000n, "h-june");
      await repo.upsertMessage(GUILD, CAL, CHANNEL, 2024, 7, 0, 20000n, "h-july");

      expect(await repo.getMessages(GUILD, CAL, 2024, 6)).toHaveLength(1);
      expect(await repo.getMessages(GUILD, CAL, 2024, 7)).toHaveLength(1);
    });
  });

  describe("deleteMessagesAboveIndex", () => {
    test("removes messages with index strictly above maxIndex", async () => {
      await seedSchedule(db);
      await repo.upsertMessage(GUILD, CAL, CHANNEL, 2024, 6, 0, 10000n, "h0");
      await repo.upsertMessage(GUILD, CAL, CHANNEL, 2024, 6, 1, 20000n, "h1");
      await repo.upsertMessage(GUILD, CAL, CHANNEL, 2024, 6, 2, 30000n, "h2");

      await repo.deleteMessagesAboveIndex(GUILD, CAL, 2024, 6, 0);

      const remaining = await repo.getMessages(GUILD, CAL, 2024, 6);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].messageIndex).toBe(0);
    });

    test("keeps the message at maxIndex", async () => {
      await seedSchedule(db);
      await repo.upsertMessage(GUILD, CAL, CHANNEL, 2024, 6, 1, 20000n, "h1");
      await repo.deleteMessagesAboveIndex(GUILD, CAL, 2024, 6, 1);

      const remaining = await repo.getMessages(GUILD, CAL, 2024, 6);
      expect(remaining).toHaveLength(1);
    });
  });

  describe("markArchived", () => {
    test("sets isArchived to true for all messages in that year/month", async () => {
      await seedSchedule(db);
      await repo.upsertMessage(GUILD, CAL, CHANNEL, 2024, 6, 0, 10000n, "h0");
      await repo.upsertMessage(GUILD, CAL, CHANNEL, 2024, 6, 1, 20000n, "h1");

      await repo.markArchived(GUILD, CAL, 2024, 6);

      const messages = await repo.getMessages(GUILD, CAL, 2024, 6);
      expect(messages.every((m) => m.isArchived)).toBe(true);
    });

    test("does not archive messages from other months", async () => {
      await seedSchedule(db);
      await repo.upsertMessage(GUILD, CAL, CHANNEL, 2024, 6, 0, 10000n, "h-june");
      await repo.upsertMessage(GUILD, CAL, CHANNEL, 2024, 7, 0, 20000n, "h-july");

      await repo.markArchived(GUILD, CAL, 2024, 6);

      const julyMessages = await repo.getMessages(GUILD, CAL, 2024, 7);
      expect(julyMessages[0].isArchived).toBe(false);
    });

    test("is idempotent — calling markArchived twice causes no error", async () => {
      await seedSchedule(db);
      await repo.upsertMessage(GUILD, CAL, CHANNEL, 2024, 6, 0, 10000n, "h0");

      await repo.markArchived(GUILD, CAL, 2024, 6);
      await repo.markArchived(GUILD, CAL, 2024, 6);

      const messages = await repo.getMessages(GUILD, CAL, 2024, 6);
      expect(messages[0].isArchived).toBe(true);
    });
  });

  describe("clearContentHashes", () => {
    test("resets contentHash to empty string for messages in that month", async () => {
      await seedSchedule(db);
      await repo.upsertMessage(GUILD, CAL, CHANNEL, 2024, 6, 0, 10000n, "abc123");

      await repo.clearContentHashes(GUILD, CAL, 2024, 6);

      const messages = await repo.getMessages(GUILD, CAL, 2024, 6);
      expect(messages[0].contentHash).toBe("");
    });

    test("does not affect messages from other months", async () => {
      await seedSchedule(db);
      await repo.upsertMessage(GUILD, CAL, CHANNEL, 2024, 6, 0, 10000n, "june-hash");
      await repo.upsertMessage(GUILD, CAL, CHANNEL, 2024, 7, 0, 20000n, "july-hash");

      await repo.clearContentHashes(GUILD, CAL, 2024, 6);

      const julyMessages = await repo.getMessages(GUILD, CAL, 2024, 7);
      expect(julyMessages[0].contentHash).toBe("july-hash");
    });
  });
});
