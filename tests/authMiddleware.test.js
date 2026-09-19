import assert from "node:assert/strict";
import { test } from "node:test";
import User from "../models/User.js";

process.env.JWT_SECRET = "juvo-middleware-test-only-secret";
const { requireAuth } = await import("../middleware/authMiddleware.js");
const { signToken } = await import("../utils/token.js");

const user = { id: "aaaaaaaaaaaaaaaaaaaaaaaa", email: "test@example.invalid" };
const response = () => ({ status(code) { this.code = code; return this; }, json(data) { this.data = data; } });

test("missing or invalid credentials return unauthorized", async () => {
  for (const authorization of [undefined, "Bearer invalid"]) {
    const res = response();
    await requireAuth({ headers: { authorization } }, res, () => assert.fail("Must not continue"));
    assert.equal(res.code, 401);
  }
});

test("a valid session continues with the authenticated user", async (t) => {
  t.mock.method(User, "findById", async () => user);
  const req = { headers: { authorization: `Bearer ${signToken(user)}` } };
  let continued = false;
  await requireAuth(req, response(), () => { continued = true; });
  assert.equal(continued, true);
  assert.equal(req.user, user);
});

test("a database outage is forwarded instead of falsely expiring a valid session", async (t) => {
  const failure = new Error("Database temporarily unavailable");
  t.mock.method(User, "findById", async () => { throw failure; });
  const res = response();
  let forwarded;
  await requireAuth({ headers: { authorization: `Bearer ${signToken(user)}` } }, res, (error) => { forwarded = error; });
  assert.equal(forwarded, failure);
  assert.equal(res.code, undefined);
});
