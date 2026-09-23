import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Explicit cleanup since this project uses `globals: false` (tests import
// describe/it/etc. directly from "vitest") -- Testing Library's automatic afterEach
// hook only registers itself when it detects a global test framework.
afterEach(() => {
  cleanup();
});
