import { describe, expect, test } from "bun:test";

import dayjs from "@/shared/domain/dayjs";

import parseDuration from "./parseDuration";

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
  ])(
    "parseDuration($durationString)",
    ({ durationString, expectedDuration }) => {
      test(`parses custom ID ${durationString}`, () => {
        const dur = parseDuration(durationString);

        if (expectedDuration === null) {
          expect(dur).toBeNull();
        } else {
          expect(dur).not.toBeNull();

          if (expectedDuration === null) {
            throw new Error("duration is not null but expected null");
          }

          if (!dur) {
            throw new Error("duration is unexpectedly null");
          }

          expect(dur.asSeconds()).toEqual(expectedDuration.asSeconds());
        }
      });
    },
  );
});
