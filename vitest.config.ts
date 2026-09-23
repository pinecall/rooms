/** The suite: the log, the fold and the store, in node against a fake gateway. */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "room",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
