import test from "node:test";
import assert from "node:assert/strict";
import { parseAllowedOrigins } from "../utils/corsOrigins.js";

test("normalizes configured client URLs to browser origins", () => {
  assert.deepEqual(
    parseAllowedOrigins(
      " https://juvo-os.app/ , https://preview.juvo-os.app/client ",
    ),
    ["https://juvo-os.app", "https://preview.juvo-os.app"],
  );
});

test("rejects wildcard origins when credentials are enabled", () => {
  assert.throws(() => parseAllowedOrigins("*"), /Wildcard CORS origins/);
});

test("rejects invalid and non-HTTP origins", () => {
  assert.throws(() => parseAllowedOrigins("juvo-os.app"), /absolute URLs/);
  assert.throws(() => parseAllowedOrigins("file:///tmp"), /HTTP or HTTPS/);
});
