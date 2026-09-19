import assert from "node:assert/strict";
import { test } from "node:test";
import { errorHandler } from "../middleware/errorHandler.js";

function responseFor(error) {
  const response = { status(code) { this.code = code; return this; }, json(data) { this.data = data; } };
  errorHandler(error, {}, response, () => {});
  return response;
}

test("unexpected errors do not reveal database details", () => {
  const response = responseFor(new Error("mongodb://private-host:27017/users"));
  assert.equal(response.code, 500);
  assert.equal(response.data.message.includes("private-host"), false);
});

test("invalid IDs, duplicate records and malformed JSON have useful HTTP statuses", () => {
  for (const [error, status] of [[{ name: "CastError" }, 400], [{ name: "ValidationError" }, 400], [{ code: 11000 }, 409], [{ type: "entity.parse.failed" }, 400]]) {
    assert.equal(responseFor(error).code, status);
  }
  assert.equal(responseFor({ status: "invalid" }).code, 500);
  assert.equal(responseFor({ status: 409, message: "Trade already closed." }).data.message, "Trade already closed.");
});

test("errors after response headers are sent are delegated", () => {
  const error = new Error("late error");
  let delegated;
  errorHandler(error, {}, { headersSent: true }, (value) => { delegated = value; });
  assert.equal(delegated, error);
});
