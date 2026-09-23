// The three public surfaces, pinned by name: adding an export means editing a list here on purpose.

import { describe, expect, it } from "vitest";

import * as page from "../src/index.js";
import * as react from "../src/react/index.js";
import * as server from "../src/server/index.js";

describe("the public surfaces", () => {
  it("@pinecall/room is the room and the rows", () => {
    expect(Object.keys(page).sort()).toEqual(["brief", "knownBy", "room", "rowsOf"]);
  });

  it("@pinecall/room/react is two hooks", () => {
    expect(Object.keys(react).sort()).toEqual(["useRoom", "useStore"]);
  });

  it("@pinecall/room/server is the two calls a key makes, and the refusal", () => {
    expect(Object.keys(server).sort()).toEqual(["GatewayRefused", "dial", "mint"]);
  });
});
