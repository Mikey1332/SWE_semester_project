import { existsSync } from "node:fs";
import { expect, test } from "vitest";

test("frontend setup files exist", () => {
  expect(existsSync("package.json")).toBe(true);
  expect(existsSync("package-lock.json")).toBe(true);
});