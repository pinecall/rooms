/** The suite: the log and the store in node against a fake gateway; the seat on happy-dom. */

import { configDefaults, defineConfig } from "vitest/config";

// Two environments, split by directory. Everything that needs a document — an audio element for
// the agent's voice — lives under test/seat; everything else runs in node, where a `document`
// reached by accident is a failure and not a silent pass.
const DOM = ["test/seat/**/*.test.ts"];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "room",
          environment: "node",
          include: ["test/**/*.test.ts"],
          exclude: [...configDefaults.exclude, ...DOM],
        },
      },
      {
        test: { name: "dom", environment: "happy-dom", include: DOM },
      },
    ],
  },
});
