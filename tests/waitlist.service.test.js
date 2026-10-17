import assert from "node:assert/strict";
import test from "node:test";
import WaitlistInvitation from "../models/WaitlistInvitation.js";
import Waitlist from "../models/Waitlist.js";
import {
  joinWaitlistService,
  waitlistEmailSender,
} from "../services/waitlist.service.js";

test("waitlist signup stores a hashed code with a 30-day expiry and emails the raw code", async (t) => {
  let created;
  let sent;
  t.mock.method(WaitlistInvitation, "findOne", () => ({
    select: async () => null,
  }));
  t.mock.method(Waitlist, "findOne", () => ({ select: async () => null }));
  t.mock.method(Waitlist, "create", async (values) => ({
    ...values,
    _id: "waitlist-1",
  }));
  t.mock.method(Waitlist, "updateOne", async () => ({}));
  t.mock.method(WaitlistInvitation, "create", async (values) => {
    created = { ...values, _id: "invitation-1" };
    return created;
  });
  t.mock.method(WaitlistInvitation, "updateOne", async () => ({}));
  t.mock.method(waitlistEmailSender, "send", async (...args) => {
    sent = args;
  });

  const before = Date.now();
  const result = await joinWaitlistService({
    email: " Trader@Example.com ",
    name: "Trader",
  });

  assert.equal(result.email, "trader@example.com");
  assert.match(created.codeHash, /^[a-f0-9]{64}$/);
  assert.equal(created.discountPercent, 40);
  assert.ok(
    created.expiresAt.getTime() - created.issuedAt.getTime() ===
      30 * 24 * 60 * 60 * 1000,
  );
  assert.ok(created.issuedAt.getTime() >= before);
  assert.equal(sent[0], "trader@example.com");
  assert.match(sent[2], /^[A-Z0-9_-]{24}$/);
  assert.notEqual(sent[2], created.codeHash);
});

test("duplicate active waitlist submissions are rejected without sending another invitation", async (t) => {
  t.mock.method(Waitlist, "findOne", () => ({
    select: async () => ({ status: "active", promotionalOptOut: false }),
  }));
  t.mock.method(WaitlistInvitation, "findOne", () => ({
    select: async () => ({
      status: "sent",
      expiresAt: new Date(Date.now() + 1000),
    }),
  }));
  await assert.rejects(joinWaitlistService({ email: "trader@example.com" }), {
    code: "WAITLIST_EXISTS",
    status: 409,
  });
});
