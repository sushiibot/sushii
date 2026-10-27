import { describe, expect, mock, test } from "bun:test";
import type {
  ButtonInteraction,
  Client,
  ModalSubmitInteraction,
} from "discord.js";
import { MessageFlags } from "discord.js";
import type { Logger } from "pino";

import type {
  ScamCandidateRepository,
  ScamCandidateReviewStatus,
  ScamCandidateState,
} from "../domain/repositories/ScamCandidateRepository";
import type { ScamImageHashRepository } from "../domain/repositories/ScamImageHashRepository";
import type { ScamCandidateMetrics } from "../infrastructure/metrics/ScamCandidateMetrics";
import { SCAM_CANDIDATE_MODAL_LABEL_INPUT } from "../presentation/handlers/scamCandidateCustomIds";
import { ScamCandidateService } from "./ScamCandidateService";
import type { ScamImageHashService } from "./ScamImageHashService";

const REVIEW_ID = "review-1";
const USER_ID = "200000000000000001";

function state(
  status: ScamCandidateReviewStatus,
  overrides: Partial<ScamCandidateState> = {},
): ScamCandidateState {
  return {
    key: "key",
    status,
    trigger: "threshold",
    reviewId: REVIEW_ID,
    triggeredByUserId: USER_ID,
    reviewChannelId: "300000000000000001",
    reviewMessageId: "300000000000000002",
    channelCount: 3,
    guildIds: ["400000000000000001"],
    seenByUserIds: [],
    newImageResults: [
      {
        filename: "0_scam.png",
        phash: "12345",
        closestId: null,
        closestLabel: null,
        closestDistance: null,
        isNew: true,
        attachmentIndex: 0,
      },
    ],
    classificationResult: null,
    attachmentUrls: ["https://cdn.example/0_scam.png"],
    guildNames: ["Guild"],
    content: null,
    claimedAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function setup() {
  const candidateRepository = {
    getByReviewId: mock(
      async (_id: string): Promise<ScamCandidateState | null> => null,
    ),
    resolveReview: mock(
      async (_id: string, _s: string): Promise<ScamCandidateState | null> =>
        null,
    ),
    revertReview: mock(
      async (_id: string): Promise<ScamCandidateState | null> => null,
    ),
    undoIgnore: mock(
      async (_id: string): Promise<ScamCandidateState | null> => null,
    ),
  };
  const hashRepository = {
    add: mock(async () => 1),
    removeByPhashes: mock(async (_p: bigint[]) => undefined),
  };
  const client = {
    users: { cache: new Map([[USER_ID, { username: "scammer" }]]) },
    guilds: { cache: new Map() },
  };
  const metrics = { reviewOutcomeCounter: { add: mock() } };
  const logger = { error: mock(), warn: mock(), debug: mock(), info: mock() };

  const service = new ScamCandidateService(
    client as unknown as Client,
    {} as ScamImageHashService,
    hashRepository as unknown as ScamImageHashRepository,
    candidateRepository as unknown as ScamCandidateRepository,
    metrics as unknown as ScamCandidateMetrics,
    logger as unknown as Logger,
  );

  return { service, candidateRepository, hashRepository };
}

function responses() {
  return {
    reply: mock(async (_payload: unknown) => undefined),
    update: mock(async (_payload: unknown) => undefined),
    deferUpdate: mock(async () => undefined),
    followUp: mock(async (_payload: unknown) => undefined),
    editReply: mock(async (_payload: unknown) => undefined),
  };
}

type Responses = ReturnType<typeof responses>;

function button() {
  const r = responses();
  return { r, interaction: r as unknown as ButtonInteraction };
}

function modal(label = "promo", fromMessage = true) {
  const r = responses();
  const interaction = {
    ...r,
    isFromMessage: () => fromMessage,
    fields: {
      getTextInputValue: (id: string) =>
        id === SCAM_CANDIDATE_MODAL_LABEL_INPUT ? label : "",
    },
  };
  return { r, interaction: interaction as unknown as ModalSubmitInteraction };
}

function expectOnlyEphemeralReply(r: Responses, content: string) {
  expect(r.reply).toHaveBeenCalledTimes(1);
  expect(r.reply).toHaveBeenCalledWith({
    content,
    flags: MessageFlags.Ephemeral,
  });
  expect(r.update).not.toHaveBeenCalled();
  expect(r.deferUpdate).not.toHaveBeenCalled();
  expect(r.followUp).not.toHaveBeenCalled();
  expect(r.editReply).not.toHaveBeenCalled();
}

function expectOnlyUpdate(r: Responses): string {
  expect(r.update).toHaveBeenCalledTimes(1);
  expect(r.reply).not.toHaveBeenCalled();
  expect(r.deferUpdate).not.toHaveBeenCalled();
  expect(r.followUp).not.toHaveBeenCalled();
  expect(r.editReply).not.toHaveBeenCalled();
  return JSON.stringify(r.update.mock.calls[0][0]);
}

const EXPIRED =
  "This review has expired — a new review will appear automatically.";
const RESOLVED = "This review has already been resolved.";

describe("ScamCandidateService.handleIgnore", () => {
  test("an expired review gets one ephemeral reply", async () => {
    const t = setup();
    const { r, interaction } = button();

    await t.service.handleIgnore(REVIEW_ID, interaction);

    expectOnlyEphemeralReply(r, EXPIRED);
  });

  test("an already resolved review gets one ephemeral reply", async () => {
    const t = setup();
    t.candidateRepository.getByReviewId.mockResolvedValue(state("ignored"));
    const { r, interaction } = button();

    await t.service.handleIgnore(REVIEW_ID, interaction);

    expectOnlyEphemeralReply(r, RESOLVED);
    expect(t.candidateRepository.resolveReview).not.toHaveBeenCalled();
  });

  test("losing the resolve race gets one ephemeral reply", async () => {
    const t = setup();
    t.candidateRepository.getByReviewId.mockResolvedValue(state("reviewing"));
    const { r, interaction } = button();

    await t.service.handleIgnore(REVIEW_ID, interaction);

    expectOnlyEphemeralReply(r, RESOLVED);
  });

  test("ignoring updates the review message directly", async () => {
    const t = setup();
    t.candidateRepository.getByReviewId.mockResolvedValue(state("reviewing"));
    t.candidateRepository.resolveReview.mockResolvedValue(state("ignored"));
    const { r, interaction } = button();

    await t.service.handleIgnore(REVIEW_ID, interaction);

    expect(expectOnlyUpdate(r)).toContain("Ignored");
  });
});

describe("ScamCandidateService.handleLabelModal", () => {
  test("an expired review gets one ephemeral reply", async () => {
    const t = setup();
    const { r, interaction } = modal();

    await t.service.handleLabelModal(REVIEW_ID, interaction);

    expectOnlyEphemeralReply(r, EXPIRED);
    expect(t.hashRepository.add).not.toHaveBeenCalled();
  });

  test("a submit not from a message throws before writing anything", async () => {
    const t = setup();
    t.candidateRepository.getByReviewId.mockResolvedValue(state("reviewing"));
    const { r, interaction } = modal("promo", false);

    await expect(
      t.service.handleLabelModal(REVIEW_ID, interaction),
    ).rejects.toThrow(
      "Scam candidate label modal should be from a button on a message",
    );

    expect(t.hashRepository.add).not.toHaveBeenCalled();
    expect(t.candidateRepository.resolveReview).not.toHaveBeenCalled();
    expect(r.update).not.toHaveBeenCalled();
    expect(r.reply).not.toHaveBeenCalled();
  });

  test("when no hash is added the review shows the failure with one update", async () => {
    const t = setup();
    t.candidateRepository.getByReviewId.mockResolvedValue(state("reviewing"));
    t.hashRepository.add.mockRejectedValue(new Error("db down"));
    const { r, interaction } = modal();

    await t.service.handleLabelModal(REVIEW_ID, interaction);

    expect(expectOnlyUpdate(r)).toContain("failed to add hashes");
    expect(t.candidateRepository.resolveReview).not.toHaveBeenCalled();
  });

  test("losing the resolve race gets one ephemeral reply", async () => {
    const t = setup();
    t.candidateRepository.getByReviewId.mockResolvedValue(state("reviewing"));
    const { r, interaction } = modal();

    await t.service.handleLabelModal(REVIEW_ID, interaction);

    expectOnlyEphemeralReply(r, RESOLVED);
  });

  test("adding updates the review message directly", async () => {
    const t = setup();
    t.candidateRepository.getByReviewId.mockResolvedValue(state("reviewing"));
    t.candidateRepository.resolveReview.mockResolvedValue(state("added"));
    const { r, interaction } = modal();

    await t.service.handleLabelModal(REVIEW_ID, interaction);

    expect(t.hashRepository.add).toHaveBeenCalledWith(
      12345n,
      "promo",
      undefined,
    );
    expect(expectOnlyUpdate(r)).toContain("Added 1 image");
  });
});

describe("ScamCandidateService.handleRevert", () => {
  test("an expired review gets one ephemeral reply", async () => {
    const t = setup();
    const { r, interaction } = button();

    await t.service.handleRevert(REVIEW_ID, interaction);

    expectOnlyEphemeralReply(r, EXPIRED);
  });

  test("a review that isn't added gets one ephemeral reply", async () => {
    const t = setup();
    t.candidateRepository.getByReviewId.mockResolvedValue(state("ignored"));
    const { r, interaction } = button();

    await t.service.handleRevert(REVIEW_ID, interaction);

    expectOnlyEphemeralReply(r, RESOLVED);
    expect(t.candidateRepository.revertReview).not.toHaveBeenCalled();
  });

  test("losing the revert race gets one ephemeral reply", async () => {
    const t = setup();
    t.candidateRepository.getByReviewId.mockResolvedValue(state("added"));
    const { r, interaction } = button();

    await t.service.handleRevert(REVIEW_ID, interaction);

    expectOnlyEphemeralReply(r, RESOLVED);
  });

  test("reverting removes the hashes and updates the review directly", async () => {
    const t = setup();
    t.candidateRepository.getByReviewId.mockResolvedValue(state("added"));
    t.candidateRepository.revertReview.mockResolvedValue(state("reverted"));
    const { r, interaction } = button();

    await t.service.handleRevert(REVIEW_ID, interaction);

    expect(t.hashRepository.removeByPhashes).toHaveBeenCalledWith([12345n]);
    expect(expectOnlyUpdate(r)).toContain("Reverted");
  });
});

describe("ScamCandidateService.handleUndoIgnore", () => {
  test("a review that isn't ignored gets one ephemeral reply", async () => {
    const t = setup();
    t.candidateRepository.getByReviewId.mockResolvedValue(state("reviewing"));
    const { r, interaction } = button();

    await t.service.handleUndoIgnore(REVIEW_ID, interaction);

    expectOnlyEphemeralReply(
      r,
      "This review is no longer in an ignored state.",
    );
  });

  test("losing the undo race gets one ephemeral reply", async () => {
    const t = setup();
    t.candidateRepository.getByReviewId.mockResolvedValue(state("ignored"));
    const { r, interaction } = button();

    await t.service.handleUndoIgnore(REVIEW_ID, interaction);

    expectOnlyEphemeralReply(
      r,
      "This review is no longer in an ignored state.",
    );
  });

  test("undoing updates the review directly", async () => {
    const t = setup();
    t.candidateRepository.getByReviewId.mockResolvedValue(state("ignored"));
    t.candidateRepository.undoIgnore.mockResolvedValue(state("reviewing"));
    const { r, interaction } = button();

    await t.service.handleUndoIgnore(REVIEW_ID, interaction);

    expectOnlyUpdate(r);
  });
});
