import { describe, expect, test } from "bun:test";

import dayjs from "@/shared/domain/dayjs";

import parseDurationOrTimestamp from "./parseDurationOrTimestamp";

describe("parseDuration", () => {
  describe.each([
    {
      durationString: "1s",
      expectedDuration: dayjs.duration({ seconds: 1 }),
    },
    {
      durationString: "5 seconds",
      expectedDuration: dayjs.duration({ seconds: 5 }),
    },
    {
      durationString: "3 hours 20 minutes",
      expectedDuration: dayjs.duration({ hours: 3, minutes: 20 }),
    },
    {
      durationString: "0s",
      expectedDuration: null,
    },
    {
      durationString: "not a valid duration",
      expectedDuration: null,
    },
    {
      durationString: `<t:${dayjs
        .utc()
        .add(dayjs.duration({ hours: 1 }))
        .unix()}:f>`,
      expectedDuration: dayjs.duration({ hours: 1 }),
    },
  ])(
    "parseDurationOrTimestamp($durationString)",
    ({ durationString, expectedDuration }) => {
      test(`parses duration string ${durationString}`, () => {
        const dur = parseDurationOrTimestamp(durationString);

        if (expectedDuration === null) {
          expect(dur).toBeNull();
        } else {
          expect(dur).not.toBeNull();

          if (expectedDuration === null) {
            throw new Error("duration is not null but expected null");
          }
          if (dur === null) {
            throw new Error("duration is null but expected not null");
          }

          const durRoundedSec = Math.ceil(dur.asSeconds());
          expect(durRoundedSec).toEqual(expectedDuration.asSeconds());
        }
      });
    },
  );
});
