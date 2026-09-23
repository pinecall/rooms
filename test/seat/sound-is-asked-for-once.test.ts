// A browser that has not let the page make a sound says so; one click answers it, and it is not asked again.

import { describe, expect, it } from "vitest";

import { FakeLivekit } from "../a-fake-livekit.js";
import { take } from "./a-seat-at-hand.js";

describe("sound, at the seat", () => {
  it("says whether the browser may play, and starts audio when asked", async () => {
    const livekit = new FakeLivekit();
    livekit.canPlaybackAudio = false;
    const { seat, wantsSound } = await take("talk", livekit);
    expect(seat.canPlaybackAudio()).toBe(false);

    livekit.room.playback(false);
    seat.playSound();
    await Promise.resolve();

    expect(livekit.room.audioStarts).toBe(1);
    expect(wantsSound).toEqual([true, false]);
    expect(seat.canPlaybackAudio()).toBe(true);
  });
});
