import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Phase 4 unit tests are pure logic with no DOM access — node is enough.
    // Phase 5+ component tests will switch to jsdom on a per-file basis via
    //   /** @vitest-environment jsdom */ at the top of the test.
    environment: "node",
    include: ["tests/unit/**/*.test.js"],
  },
});
