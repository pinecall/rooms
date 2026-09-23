// The public surface, pinned by name: adding an export means editing the list here on purpose.

import { describe, expect, it } from "vitest";

import * as page from "../src/index.js";

describe("the public surface", () => {
  it("@pinecall/room is the rows", () => {
    expect(Object.keys(page).sort()).toEqual(["brief", "knownBy", "rowsOf"]);
  });
});
