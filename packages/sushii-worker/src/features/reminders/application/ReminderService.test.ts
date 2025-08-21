import { beforeEach, describe, expect, it } from "bun:test";
import type { Client } from "discord.js";
import pino from "pino";

import type { Reminder } from "../domain/entities/Reminder";
import { Reminder as ReminderEntity } from "../domain/entities/Reminder";
import type { ReminderRepository } from "../domain/repositories/ReminderRepository";
import { ReminderService } from "./ReminderService";

// Mock implementations
class MockReminderRepository implements ReminderRepository {
  private reminders: Reminder[] = [];

  async save(reminder: Reminder): Promise<Reminder> {
    const existing = this.reminders.findIndex(
      (r) =>
        r.getUserId() === reminder.getUserId() &&
        r.getId() === reminder.getId(),
    );

    if (existing >= 0) {
      this.reminders[existing] = reminder;
      return reminder;
    } else {
      // For testing, generate a new ID if it's "0" (placeholder)
      if (reminder.getId() === "0") {
        const maxId = this.reminders
          .filter((r) => r.getUserId() === reminder.getUserId())
          .map((r) => parseInt(r.getId(), 10))
          .filter((id) => !isNaN(id))
          .reduce((max, current) => Math.max(max, current), 0);

        const nextId = (maxId + 1).toString();
        const reminderData = reminder.toData();
        reminderData.id = nextId;
        const newReminder = ReminderEntity.createFromDatabase(reminderData);
        this.reminders.push(newReminder);
        return newReminder;
      } else {
        this.reminders.push(reminder);
        return reminder;
      }
    }
  }

  async findByUserIdAndId(
    userId: string,
    id: string,
  ): Promise<Reminder | null> {
    return (
      this.reminders.find(
        (r) => r.getUserId() === userId && r.getId() === id,
      ) || null
    );
  }

  async findByUserId(userId: string): Promise<Reminder[]> {
    return this.reminders.filter((r) => r.getUserId() === userId);
  }

  async findExpired(): Promise<Reminder[]> {
    return this.reminders.filter((r) => r.isExpired());
  }

  async deleteByUserIdAndId(
    userId: string,
    id: string,
  ): Promise<Reminder | null> {
    const index = this.reminders.findIndex(
      (r) => r.getUserId() === userId && r.getId() === id,
    );
    if (index >= 0) {
      return this.reminders.splice(index, 1)[0];
    }
    return null;
  }

  async countPending(): Promise<number> {
    return this.reminders.filter((r) => !r.isExpired()).length;
  }

  async findForAutocomplete(
    userId: string,
    query: string,
  ): Promise<Reminder[]> {
    return this.reminders
      .filter(
        (r) => r.getUserId() === userId && r.getDescription().includes(query),
      )
      .slice(0, 25);
  }

  clear(): void {
    this.reminders = [];
  }
}

const mockClient = {
  users: {
    fetch: async () => ({
      send: async () => {
        // Mock DM sending
      },
    }),
  },
} as unknown as Client;

const mockLogger = pino({ level: "silent" });

describe("ReminderService", () => {
  let reminderService: ReminderService;
  let mockRepository: MockReminderRepository;

  beforeEach(() => {
    mockRepository = new MockReminderRepository();
    reminderService = new ReminderService(
      mockRepository,
      mockClient,
      mockLogger,
    );
  });

  describe("createReminder", () => {
    it("should create a reminder successfully", async () => {
      const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

      const result = await reminderService.createReminder({
        userId: "123",
        description: "Test reminder",
        expireAt: futureDate,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val.getUserId()).toBe("123");
        expect(result.val.getDescription()).toBe("Test reminder");
        expect(result.val.getId()).toBe("1");
      }
    });

    it("should increment reminder ID for subsequent reminders", async () => {
      const futureDate = new Date(Date.now() + 60 * 60 * 1000);

      const result1 = await reminderService.createReminder({
        userId: "123",
        description: "First reminder",
        expireAt: futureDate,
      });

      const result2 = await reminderService.createReminder({
        userId: "123",
        description: "Second reminder",
        expireAt: futureDate,
      });

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);

      if (result1.ok && result2.ok) {
        expect(result1.val.getId()).toBe("1");
        expect(result2.val.getId()).toBe("2");
      }
    });

    it("should reject empty description", async () => {
      const futureDate = new Date(Date.now() + 60 * 60 * 1000);

      const result = await reminderService.createReminder({
        userId: "123",
        description: "",
        expireAt: futureDate,
      });

      expect(result.err).toBe(true);
      if (result.err) {
        expect(result.val).toBe("Reminder description cannot be empty");
      }
    });

    it("should reject past expiry date", async () => {
      const pastDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

      const result = await reminderService.createReminder({
        userId: "123",
        description: "Test reminder",
        expireAt: pastDate,
      });

      expect(result.err).toBe(true);
      if (result.err) {
        expect(result.val).toBe("Reminder expiry time must be in the future");
      }
    });
  });

  describe("listUserReminders", () => {
    it("should return user's reminders", async () => {
      const futureDate = new Date(Date.now() + 60 * 60 * 1000);

      await reminderService.createReminder({
        userId: "123",
        description: "Test reminder",
        expireAt: futureDate,
      });

      const reminders = await reminderService.listUserReminders("123");
      expect(reminders).toHaveLength(1);
      expect(reminders[0].getDescription()).toBe("Test reminder");
    });

    it("should return empty array for user with no reminders", async () => {
      const reminders = await reminderService.listUserReminders("456");
      expect(reminders).toHaveLength(0);
    });
  });

  describe("deleteReminder", () => {
    it("should delete existing reminder", async () => {
      const futureDate = new Date(Date.now() + 60 * 60 * 1000);

      const createResult = await reminderService.createReminder({
        userId: "123",
        description: "Test reminder",
        expireAt: futureDate,
      });

      expect(createResult.ok).toBe(true);

      const deleteResult = await reminderService.deleteReminder("123", "1");
      expect(deleteResult.ok).toBe(true);

      if (deleteResult.ok) {
        expect(deleteResult.val?.getDescription()).toBe("Test reminder");
      }

      const remainingReminders = await reminderService.listUserReminders("123");
      expect(remainingReminders).toHaveLength(0);
    });

    it("should return error for non-existent reminder", async () => {
      const result = await reminderService.deleteReminder("123", "999");
      expect(result.err).toBe(true);

      if (result.err) {
        expect(result.val).toBe(
          "Reminder not found or you don't have permission to delete it",
        );
      }
    });
  });

  describe("processExpiredReminders", () => {
    it("should process expired reminders", async () => {
      // Create an expired reminder
      const pastDate = new Date(Date.now() - 60 * 60 * 1000);
      const reminderData = {
        id: "1",
        userId: "123",
        description: "Expired reminder",
        setAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        expireAt: pastDate,
      };

      const reminder = ReminderEntity.createFromDatabase(reminderData);
      await mockRepository.save(reminder);

      const result = await reminderService.processExpiredReminders();

      expect(result.sent).toBe(1);
      expect(result.failed).toBe(0);

      // Verify the reminder was deleted
      const remainingReminders = await reminderService.listUserReminders("123");
      expect(remainingReminders).toHaveLength(0);
    });
  });
});
