import { describe, expect, it, mock, beforeEach } from "bun:test";
import pino from "pino";

import type { Schedule } from "@/features/schedule/domain/entities/Schedule";
import type { ScheduleRepository, UpsertScheduleData } from "@/features/schedule/domain/repositories/ScheduleRepository";
import type { ScheduleMessageRepository } from "@/features/schedule/domain/repositories/ScheduleMessageRepository";
import { GoogleCalendarClient, GoogleCalendarError } from "@/features/schedule/infrastructure/google/GoogleCalendarClient";
import { ScheduleChannelService, type ConfigureScheduleChannelInput, type EditScheduleChannelInput } from "./ScheduleChannelService";

const logger = pino({ level: "silent" });

// ── Factories ──────────────────────────────────────────────────────────────────

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  const now = new Date();
  return {
    guildId: 1n,
    calendarId: "cal@group.calendar.google.com",
    channelId: 100n,
    logChannelId: 200n,
    configuredByUserId: 999n,
    calendarTitle: "My Calendar",
    displayTitle: "My Schedule",
    syncToken: null,
    pollIntervalSec: 120,
    nextPollAt: now,
    consecutiveFailures: 0,
    lastErrorAt: null,
    lastErrorReason: null,
    discordChannelFailedAt: null,
    accentColor: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeInput(overrides: Partial<ConfigureScheduleChannelInput> = {}): ConfigureScheduleChannelInput {
  return {
    guildId: 1n,
    channelId: 100n,
    logChannelId: 200n,
    configuredByUserId: 999n,
    calendarInput: "cal@group.calendar.google.com",
    title: "My Schedule",
    ...overrides,
  };
}

// ── Mock repo builder ─────────────────────────────────────────────────────────

function makeRepo(
  existingSchedules: Schedule[] = [],
  upsertResult: Schedule = makeSchedule(),
): ScheduleRepository & ScheduleMessageRepository {
  return {
    findAllByGuild: mock(async () => existingSchedules),
    findByChannel: mock(async () => existingSchedules[0] ?? null),
    findByCalendar: mock(async () => null),
    findAllDue: mock(async () => []),
    upsert: mock(async (_data: UpsertScheduleData) => upsertResult),
    delete: mock(async () => {}),
    updateSyncToken: mock(async () => {}),
    recordFailure: mock(async () => {}),
    resetFailures: mock(async () => {}),
    recordDiscordChannelError: mock(async () => {}),
    updateSettings: mock(async () => upsertResult),
    // ScheduleMessageRepository
    getMessages: mock(async () => []),
    upsertMessage: mock(async () => {}),
    deleteMessagesAboveIndex: mock(async () => {}),
    markArchived: mock(async () => {}),
    clearContentHashes: mock(async () => {}),
    deleteAllMessages: mock(async () => {}),
  };
}

// ── Mock GoogleCalendarClient builder ─────────────────────────────────────────

function makeCalendarClient(overrides: {
  getCalendarMetadata?: () => Promise<{ summary: string; timeZone: string }>;
} = {}): GoogleCalendarClient {
  const client = Object.create(GoogleCalendarClient.prototype) as GoogleCalendarClient;
  client.getCalendarMetadata = overrides.getCalendarMetadata ?? mock(async () => ({
    summary: "My Calendar",
    timeZone: "America/New_York",
  }));
  client.listEvents = mock(async () => ({ items: [] }));
  return client;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("ScheduleChannelService.configure", () => {
  it("returns error when Google Calendar API key is not configured", async () => {
    const service = new ScheduleChannelService(
      makeRepo(),
      makeCalendarClient(),
      false, // isConfigured = false
      logger,
    );
    const result = await service.configure(makeInput());
    expect(result.ok).toBe(false);
    expect(result.val).toMatch(/GOOGLE_CALENDAR_API_KEY/);
  });

  it("returns error for an unparseable calendar input", async () => {
    const service = new ScheduleChannelService(
      makeRepo(),
      makeCalendarClient(),
      true,
      logger,
    );
    const result = await service.configure(makeInput({ calendarInput: "not-a-calendar" }));
    expect(result.ok).toBe(false);
    expect(result.val).toMatch(/Could not parse/);
  });

  it("returns error when the channel is already in use by another schedule", async () => {
    const existing = makeSchedule({ channelId: 100n, calendarId: "other@group.calendar.google.com" });
    const service = new ScheduleChannelService(
      makeRepo([existing]),
      makeCalendarClient(),
      true,
      logger,
    );
    const result = await service.configure(makeInput({ channelId: 100n, calendarInput: "cal@group.calendar.google.com" }));
    expect(result.ok).toBe(false);
    expect(result.val).toMatch(/already syncing/);
  });

  it("returns error when the same calendar is already configured in another channel", async () => {
    const existing = makeSchedule({ channelId: 999n, calendarId: "cal@group.calendar.google.com" });
    const service = new ScheduleChannelService(
      makeRepo([existing]),
      makeCalendarClient(),
      true,
      logger,
    );
    const result = await service.configure(makeInput({ channelId: 100n, calendarInput: "cal@group.calendar.google.com" }));
    expect(result.ok).toBe(false);
    expect(result.val).toMatch(/already syncing/);
  });

  it("returns error when guild already has 3 schedules", async () => {
    const existing = [
      makeSchedule({ channelId: 1n, calendarId: "a@group.calendar.google.com" }),
      makeSchedule({ channelId: 2n, calendarId: "b@group.calendar.google.com" }),
      makeSchedule({ channelId: 3n, calendarId: "c@group.calendar.google.com" }),
    ];
    const service = new ScheduleChannelService(
      makeRepo(existing),
      makeCalendarClient(),
      true,
      logger,
    );
    const result = await service.configure(makeInput({ channelId: 100n, calendarInput: "new@group.calendar.google.com" }));
    expect(result.ok).toBe(false);
    expect(result.val).toMatch(/maximum/);
  });

  it("returns error when the Google Calendar is not publicly accessible (403)", async () => {
    const calendarClient = makeCalendarClient({
      getCalendarMetadata: mock(async () => {
        throw new GoogleCalendarError("Forbidden", 403);
      }),
    });
    const service = new ScheduleChannelService(makeRepo(), calendarClient, true, logger);
    const result = await service.configure(makeInput());
    expect(result.ok).toBe(false);
    expect(result.val).toMatch(/not publicly accessible/);
  });

  it("returns error when the Google Calendar is not found (404)", async () => {
    const calendarClient = makeCalendarClient({
      getCalendarMetadata: mock(async () => {
        throw new GoogleCalendarError("Not Found", 404);
      }),
    });
    const service = new ScheduleChannelService(makeRepo(), calendarClient, true, logger);
    const result = await service.configure(makeInput());
    expect(result.ok).toBe(false);
    expect(result.val).toMatch(/not publicly accessible/);
  });

  it("rethrows unexpected errors from the calendar client", async () => {
    const calendarClient = makeCalendarClient({
      getCalendarMetadata: mock(async () => {
        throw new Error("network timeout");
      }),
    });
    const service = new ScheduleChannelService(makeRepo(), calendarClient, true, logger);
    await expect(service.configure(makeInput())).rejects.toThrow("network timeout");
  });

  it("returns Ok with the created schedule on success", async () => {
    const created = makeSchedule({ calendarTitle: "My Calendar", displayTitle: "Custom Name" });
    const repo = makeRepo([], created);
    const calendarClient = makeCalendarClient({
      getCalendarMetadata: mock(async () => ({ summary: "My Calendar", timeZone: "UTC" })),
    });
    const service = new ScheduleChannelService(repo, calendarClient, true, logger);
    const result = await service.configure(makeInput({ title: "Custom Name" }));

    expect(result.ok).toBe(true);
    expect(result.val).toBe(created);
    expect(repo.upsert).toHaveBeenCalledTimes(1);
  });

  it("returns error when title is blank", async () => {
    const service = new ScheduleChannelService(makeRepo(), makeCalendarClient(), true, logger);
    const result = await service.configure(makeInput({ title: "" }));
    expect(result.ok).toBe(false);
    expect(result.val).toMatch(/cannot be blank/);
  });

  it("returns error when title is whitespace only", async () => {
    const service = new ScheduleChannelService(makeRepo(), makeCalendarClient(), true, logger);
    const result = await service.configure(makeInput({ title: "   " }));
    expect(result.ok).toBe(false);
    expect(result.val).toMatch(/cannot be blank/);
  });

  it("stores the calendarTitle from Google metadata (not the user-supplied title)", async () => {
    const repo = makeRepo();
    const calendarClient = makeCalendarClient({
      getCalendarMetadata: mock(async () => ({ summary: "Title From Google", timeZone: "UTC" })),
    });
    const service = new ScheduleChannelService(repo, calendarClient, true, logger);
    await service.configure(makeInput({ title: "My Display Name" }));

    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ calendarTitle: "Title From Google" }),
    );
  });

  it("sets displayTitle from trimmed title input when provided", async () => {
    const repo = makeRepo();
    const service = new ScheduleChannelService(repo, makeCalendarClient(), true, logger);
    await service.configure(makeInput({ title: "  My Events  " }));

    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ displayTitle: "My Events" }),
    );
  });
});

describe("ScheduleChannelService.remove", () => {
  it("returns error when no schedule is configured for the channel", async () => {
    const repo = makeRepo([]);
    repo.findByChannel = mock(async () => null);
    const service = new ScheduleChannelService(repo, makeCalendarClient(), true, logger);
    const result = await service.remove(1n, 100n);
    expect(result.ok).toBe(false);
    expect(result.val).toMatch(/No schedule channel/);
  });

  it("deletes by calendarId when schedule is found", async () => {
    const existing = makeSchedule({ channelId: 100n, calendarId: "cal@group.calendar.google.com" });
    const repo = makeRepo([existing]);
    repo.findByChannel = mock(async () => existing);
    const service = new ScheduleChannelService(repo, makeCalendarClient(), true, logger);
    const result = await service.remove(1n, 100n);

    expect(result.ok).toBe(true);
    expect(repo.delete).toHaveBeenCalledWith(1n, "cal@group.calendar.google.com");
  });
});

describe("ScheduleChannelService.refresh", () => {
  it("returns error when no schedule is configured for the channel", async () => {
    const repo = makeRepo([]);
    repo.findByChannel = mock(async () => null);
    const service = new ScheduleChannelService(repo, makeCalendarClient(), true, logger);
    const result = await service.refresh(1n, 100n);
    expect(result.ok).toBe(false);
  });

  it("clears syncToken (sets to null) on refresh", async () => {
    const existing = makeSchedule({ channelId: 100n, syncToken: "old-token" });
    const repo = makeRepo([existing]);
    repo.findByChannel = mock(async () => existing);
    const service = new ScheduleChannelService(repo, makeCalendarClient(), true, logger);
    await service.refresh(1n, 100n);

    const [guildId, calendarId, syncToken] = (repo.updateSyncToken as ReturnType<typeof mock>).mock.calls[0];
    expect(guildId).toBe(1n);
    expect(calendarId).toBe(existing.calendarId);
    expect(syncToken).toBeNull();
  });

  it("clears content hashes for the current month on refresh", async () => {
    const existing = makeSchedule({ channelId: 100n });
    const repo = makeRepo([existing]);
    repo.findByChannel = mock(async () => existing);
    const service = new ScheduleChannelService(repo, makeCalendarClient(), true, logger);
    await service.refresh(1n, 100n);

    expect(repo.clearContentHashes).toHaveBeenCalledTimes(1);
    const [guildId, calendarId] = (repo.clearContentHashes as ReturnType<typeof mock>).mock.calls[0];
    expect(guildId).toBe(1n);
    expect(calendarId).toBe(existing.calendarId);
  });
});

describe("ScheduleChannelService.edit (accent color)", () => {
  function makeEditInput(overrides: Partial<EditScheduleChannelInput> = {}): EditScheduleChannelInput {
    return {
      guildId: 1n,
      channelId: 100n,
      editedByUserId: 999n,
      newDisplayTitle: "My Schedule",
      newChannelId: 100n,
      newLogChannelId: 200n,
      ...overrides,
    };
  }

  it("sets accent color when changed from null to a value", async () => {
    const existing = makeSchedule({ accentColor: null });
    const updated = makeSchedule({ accentColor: 0xff6b6b });
    const repo = makeRepo([existing]);
    repo.findByChannel = mock(async () => existing);
    repo.updateSettings = mock(async () => updated);
    const service = new ScheduleChannelService(repo, makeCalendarClient(), true, logger);

    const result = await service.edit(makeEditInput({ newAccentColor: 0xff6b6b }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected Ok");
    expect(result.val.changedFields).toContain("accentColor");
    expect(repo.updateSettings).toHaveBeenCalledWith(
      1n, existing.calendarId,
      expect.objectContaining({ accentColor: 0xff6b6b }),
    );
  });

  it("clears accent color when changed from a value to null", async () => {
    const existing = makeSchedule({ accentColor: 0xff6b6b });
    const updated = makeSchedule({ accentColor: null });
    const repo = makeRepo([existing]);
    repo.findByChannel = mock(async () => existing);
    repo.updateSettings = mock(async () => updated);
    const service = new ScheduleChannelService(repo, makeCalendarClient(), true, logger);

    const result = await service.edit(makeEditInput({ newAccentColor: null }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected Ok");
    expect(result.val.changedFields).toContain("accentColor");
    expect(repo.updateSettings).toHaveBeenCalledWith(
      1n, existing.calendarId,
      expect.objectContaining({ accentColor: null }),
    );
  });

  it("does not include accentColor in changedFields when value is unchanged", async () => {
    const existing = makeSchedule({ accentColor: 0x96cdfb, displayTitle: "Old Name" });
    const updated = makeSchedule({ accentColor: 0x96cdfb, displayTitle: "New Name" });
    const repo = makeRepo([existing]);
    repo.findByChannel = mock(async () => existing);
    repo.updateSettings = mock(async () => updated);
    const service = new ScheduleChannelService(repo, makeCalendarClient(), true, logger);

    // displayTitle changes, but accentColor stays the same
    const result = await service.edit(makeEditInput({ newDisplayTitle: "New Name", newAccentColor: 0x96cdfb }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected Ok");
    expect(result.val.changedFields).not.toContain("accentColor");
  });

  it("sets nextPollAt immediately when only accent color changes", async () => {
    const before = new Date();
    const existing = makeSchedule({ accentColor: null });
    const updated = makeSchedule({ accentColor: 0xff0000 });
    const repo = makeRepo([existing]);
    repo.findByChannel = mock(async () => existing);
    repo.updateSettings = mock(async () => updated);
    const service = new ScheduleChannelService(repo, makeCalendarClient(), true, logger);

    await service.edit(makeEditInput({ newAccentColor: 0xff0000 }));

    const patch = (repo.updateSettings as ReturnType<typeof mock>).mock.calls[0][2];
    expect(patch.nextPollAt).toBeInstanceOf(Date);
    expect((patch.nextPollAt as Date).getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("returns error when no changes are made", async () => {
    const existing = makeSchedule({ accentColor: null });
    const repo = makeRepo([existing]);
    repo.findByChannel = mock(async () => existing);
    const service = new ScheduleChannelService(repo, makeCalendarClient(), true, logger);

    const result = await service.edit(makeEditInput({ newAccentColor: null }));

    expect(result.ok).toBe(false);
    expect(result.val).toMatch(/No changes/);
  });
});
