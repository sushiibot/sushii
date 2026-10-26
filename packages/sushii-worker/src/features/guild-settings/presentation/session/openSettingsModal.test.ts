import { describe, expect, mock, test } from "bun:test";
import type {
  AwaitModalSubmitOptions,
  ButtonInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import {
  ButtonInteraction as ButtonInteractionClass,
  DiscordjsError,
  DiscordjsErrorCodes,
  ModalBuilder,
} from "discord.js";

import { openSettingsModal } from "./openSettingsModal";
import { settingsIds } from "./settingsIds";

const USER_ID = "345678901234567890";
const OTHER_USER_ID = "456789012345678901";

type ModalFilter = NonNullable<
  AwaitModalSubmitOptions<ModalSubmitInteraction>["filter"]
>;

const DiscordjsErrorCtor = DiscordjsError as unknown as new (
  code: DiscordjsErrorCodes,
  ...args: unknown[]
) => DiscordjsError;

function collectorError(reason: string): DiscordjsError {
  return new DiscordjsErrorCtor(
    DiscordjsErrorCodes.InteractionCollectorError,
    reason,
  );
}

function makeSubmission(
  customId: string,
  userId = USER_ID,
  fromMessage = true,
): ModalSubmitInteraction {
  return {
    id: "567890123456789012",
    customId,
    user: { id: userId },
    isFromMessage: () => fromMessage,
  } as unknown as ModalSubmitInteraction;
}

function makeInteraction(
  awaitModalSubmit: (
    options: AwaitModalSubmitOptions<ModalSubmitInteraction>,
  ) => Promise<ModalSubmitInteraction>,
) {
  const interaction = Object.create(
    ButtonInteractionClass.prototype,
  ) as ButtonInteraction<"cached">;
  const showModal = mock(async () => undefined);
  const awaitMock = mock(awaitModalSubmit);

  Object.defineProperty(interaction, "user", { value: { id: USER_ID } });
  Object.defineProperty(interaction, "showModal", { value: showModal });
  Object.defineProperty(interaction, "awaitModalSubmit", { value: awaitMock });

  return { interaction, showModal, awaitModalSubmit: awaitMock };
}

function makeModal(customId = settingsIds.modal("join")): ModalBuilder {
  return new ModalBuilder().setCustomId(customId).setTitle("Join message");
}

function idOf(modal: ModalBuilder): string {
  const id = modal.data.custom_id;
  if (!id) {
    throw new Error("modal has no custom ID");
  }
  return id;
}

function capturedFilter(
  awaitModalSubmit: ReturnType<typeof makeInteraction>["awaitModalSubmit"],
  call = 0,
): ModalFilter {
  const filter = awaitModalSubmit.mock.calls[call][0].filter;
  if (!filter) {
    throw new Error("filter not set");
  }
  return filter;
}

describe("openSettingsModal", () => {
  test("shows the modal and returns the submission", async () => {
    const modal = makeModal();
    const submission = makeSubmission(idOf(modal));
    const { interaction, showModal, awaitModalSubmit } = makeInteraction(
      async () => submission,
    );

    const result = await openSettingsModal(interaction, modal, {});

    expect(result).toBe(
      submission as unknown as Awaited<ReturnType<typeof openSettingsModal>>,
    );
    expect(showModal).toHaveBeenCalledWith(modal);
    expect(awaitModalSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ time: 5 * 60 * 1000 }),
    );
  });

  test("passes a custom timeout through", async () => {
    const modal = makeModal();
    const { interaction, awaitModalSubmit } = makeInteraction(async () =>
      makeSubmission(idOf(modal)),
    );

    await openSettingsModal(interaction, modal, { timeMs: 1000 });

    expect(awaitModalSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ time: 1000 }),
    );
  });

  test("filter only matches the exact ID and user", async () => {
    const modal = makeModal();
    const customId = idOf(modal);
    const { interaction, awaitModalSubmit } = makeInteraction(async () =>
      makeSubmission(customId),
    );

    await openSettingsModal(interaction, modal, {});
    const filter = capturedFilter(awaitModalSubmit);

    expect(await filter(makeSubmission(customId), new Map() as never)).toBe(
      true,
    );
    expect(
      await filter(makeSubmission(customId, OTHER_USER_ID), new Map() as never),
    ).toBe(false);
    expect(
      await filter(
        makeSubmission(settingsIds.modal("join")),
        new Map() as never,
      ),
    ).toBe(false);
    expect(
      await filter(
        makeSubmission(customId.slice(0, customId.lastIndexOf(":"))),
        new Map() as never,
      ),
    ).toBe(false);
  });

  test("filters from two opens only accept their own nonce", async () => {
    const firstModal = makeModal(settingsIds.modal("join"));
    const secondModal = makeModal(settingsIds.modal("join"));
    const { interaction, awaitModalSubmit } = makeInteraction(async () => {
      throw collectorError("time");
    });

    await openSettingsModal(interaction, firstModal, {});
    await openSettingsModal(interaction, secondModal, {});

    const firstFilter = capturedFilter(awaitModalSubmit, 0);
    const secondFilter = capturedFilter(awaitModalSubmit, 1);
    const submit = makeSubmission(idOf(secondModal));

    expect(firstModal.data.custom_id).not.toBe(secondModal.data.custom_id);
    expect(await firstFilter(submit, new Map() as never)).toBe(false);
    expect(await secondFilter(submit, new Map() as never)).toBe(true);
  });

  test("calls resetTimer on open and on submit", async () => {
    const modal = makeModal();
    const collector = { resetTimer: mock(() => undefined) };
    let resetsBeforeSubmit = -1;
    const { interaction } = makeInteraction(async () => {
      resetsBeforeSubmit = collector.resetTimer.mock.calls.length;
      return makeSubmission(idOf(modal));
    });

    await openSettingsModal(interaction, modal, { collector });

    expect(resetsBeforeSubmit).toBe(1);
    expect(collector.resetTimer).toHaveBeenCalledTimes(2);
  });

  test("returns null on timeout without a second reset", async () => {
    const modal = makeModal();
    const collector = { resetTimer: mock(() => undefined) };
    const { interaction } = makeInteraction(async () => {
      throw collectorError("time");
    });

    const result = await openSettingsModal(interaction, modal, { collector });

    expect(result).toBeNull();
    expect(collector.resetTimer).toHaveBeenCalledTimes(1);
  });

  test("rethrows discord.js errors other than the collector timeout", async () => {
    const modal = makeModal();
    const error = new DiscordjsErrorCtor(
      DiscordjsErrorCodes.InvalidType,
      "time",
      "number",
    );
    const { interaction } = makeInteraction(async () => {
      throw error;
    });

    await expect(openSettingsModal(interaction, modal, {})).rejects.toBe(error);
  });

  test("rethrows unrelated errors", async () => {
    const modal = makeModal();
    const error = new Error("boom");
    const { interaction } = makeInteraction(async () => {
      throw error;
    });

    await expect(openSettingsModal(interaction, modal, {})).rejects.toBe(error);
  });

  test("rethrows showModal failures without awaiting", async () => {
    const modal = makeModal();
    const collector = { resetTimer: mock(() => undefined) };
    const error = new Error("Unknown interaction");
    const { interaction, showModal, awaitModalSubmit } = makeInteraction(
      async () => makeSubmission(idOf(modal)),
    );
    showModal.mockImplementation(async () => {
      throw error;
    });

    await expect(
      openSettingsModal(interaction, modal, { collector }),
    ).rejects.toBe(error);
    expect(awaitModalSubmit).not.toHaveBeenCalled();
    expect(collector.resetTimer).not.toHaveBeenCalled();
  });

  test("throws when the submission is not from a message", async () => {
    const modal = makeModal();
    const { interaction } = makeInteraction(async () =>
      makeSubmission(idOf(modal), USER_ID, false),
    );

    await expect(openSettingsModal(interaction, modal, {})).rejects.toThrow(
      "Settings modal submission is not from a message",
    );
  });

  test("throws when the modal ID is not a settings modal ID", async () => {
    const modal = makeModal(settingsIds.edit("join"));
    const { interaction, showModal } = makeInteraction(async () =>
      makeSubmission(idOf(modal)),
    );

    await expect(openSettingsModal(interaction, modal, {})).rejects.toThrow(
      "Settings modal custom ID must come from settingsIds.modal",
    );
    expect(showModal).not.toHaveBeenCalled();
  });
});
